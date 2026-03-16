import fs from 'node:fs/promises';
import path from 'node:path';

import { discoverPeers } from '../peers/discoverPeers.mjs';
import { getPeersPath, savePeers } from '../peers/peerStore.mjs';

import { getTasksPath, loadTasks, acceptTask, markRunning, completeTask, failTask } from '../tasks/taskStore.mjs';
import { executeTask } from '../tasks/taskExecutor.mjs';
import { sendTaskResult } from '../tasks/taskTransport.mjs';
import { sendTaskSyncRequest } from '../tasks/taskSyncTransport.mjs';
import { recoverStuckTasks } from '../tasks/taskRecovery.mjs';
import { shouldSkipExecution } from '../tasks/taskDedup.mjs';
import { loadNodeCapabilities, taskMatchesCapabilities } from './nodeCapabilities.mjs';
import { sendTaskAccepted } from '../tasks/taskClaimTransport.mjs';
import { sendPeerGossip } from '../peers/peerGossipTransport.mjs';
import { recordTaskExecuted } from '../peers/peerStats.mjs';

function nowIso() {
  return new Date().toISOString();
}

export function getRuntimeStatePath({ workspace_path } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  return path.join(ws, 'data', 'runtime_state.json');
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

async function writeJsonAtomic(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, p);
}

export async function loadRuntimeState({ state_path } = {}) {
  try {
    const obj = await readJson(state_path);
    if (!obj || typeof obj !== 'object') throw new Error('bad');
    return { ok: true, state: obj };
  } catch {
    return {
      ok: true,
      state: {
        ok: true,
        version: 'agent_loop.v0.1',
        last_peer_refresh_at: null,
        last_task_sync_at: null,
        last_task_pick_at: null,
        last_task_executed_at: null,
        last_loop_tick_at: null,
        current_mode: null,
        last_task_sync_request_at: null,
        last_task_generation_at: null,
        last_experience_aggregation_at: null,
        last_radar_generation_at: null,
        last_radar_delivery_at: null,
        first_radar_sent: false
      }
    };
  }
}

export async function saveRuntimeState({ state_path, state } = {}) {
  await writeJsonAtomic(state_path, state);
  return { ok: true };
}

function leaseActive(task) {
  const exp = task?.lease?.expires_at;
  if (!exp) return false;
  const t = Date.parse(exp);
  return Number.isFinite(t) && t > Date.now();
}

function pickOldestPublished(tasks, matcher) {
  const pub = tasks.filter((t) => t && t.status === 'published' && !leaseActive(t));
  pub.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  if (typeof matcher !== 'function') return pub[0] || null;
  for (const t of pub) {
    const m = matcher(t);
    if (m && m.match === true) return t;
  }
  return null;
}

export async function runLoop({
  workspace_path,
  once = false,
  daemon = false,
  holder,
  relay = 'http://127.0.0.1:18884',
  directory = 'https://bootstrap.a2a.fun',
  relayUrl = 'wss://bootstrap.a2a.fun/relay',
  task_sync_peer_id = null,
  claim_announce_peers = null,
  gossip_peers = null
} = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  const h = String(holder || '').trim();
  if (!h) {
    return { ok: false, error: { code: 'MISSING_HOLDER' } };
  }

  const mode = daemon ? 'daemon' : 'once';
  const state_path = getRuntimeStatePath({ workspace_path: ws });
  const stateLoaded = await loadRuntimeState({ state_path });
  const state = stateLoaded.state;
  state.current_mode = mode;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

  const due24h = (iso) => {
    if (!iso) return true;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return true;
    return (Date.now() - t) >= 24 * 60 * 60 * 1000;
  };

  const doOneTick = async () => {
    try {
      state.last_loop_tick_at = nowIso();
      console.log(JSON.stringify({ ok: true, event: 'AGENT_LOOP_TICK', mode, holder: h, ts: state.last_loop_tick_at }));

      // Failure recovery: reclaim expired/orphaned tasks (every tick)
      await recoverStuckTasks({ workspace_path: ws }).catch(() => null);

      // FIRST_RADAR_BOOTSTRAP_V0_1: one-time bootstrap path (do not change daily cadence)
      try {
        if (daemon && state.first_radar_sent !== true) {
          const tasks_path = getTasksPath({ workspace_path: ws });
          const loaded0 = await loadTasks({ tasks_path });
          const tasks0 = Array.isArray(loaded0.table?.tasks) ? loaded0.table.tasks : [];

          if (tasks0.length === 0) {
            const { createTask } = await import('../tasks/taskSchema.mjs');

            const bootstrapSpecs = [
              { type: 'run_check', topic: 'relay_bootstrap', input: { check: 'relay_health', time_window: 'last_24h' }, requires: ['run_check'] },
              { type: 'node_diagnose', topic: 'peer_connectivity', input: { check: 'network_diagnostics', time_window: 'last_24h' }, requires: ['node_diagnose'] },
              { type: 'web_research', topic: 'agent_network_bootstrap', input: { question: 'agent network bootstrap', time_window: 'last_24h' }, requires: ['web_research'] }
            ];

            for (const s of bootstrapSpecs.slice(0, 3)) {
              const made = createTask({ type: s.type, topic: s.topic, created_by: h, input: s.input });
              if (made.ok) {
                made.task.requires = s.requires;
                await (await import('../tasks/taskStore.mjs')).publishTask({ tasks_path, task: made.task }).catch(() => null);
              }
            }

            console.log(JSON.stringify({ ok: true, event: 'FIRST_RADAR_BOOTSTRAP_TASKS_CREATED', count: Math.min(3, bootstrapSpecs.length) }));
          }
        }
      } catch {}

      // MVP automation wiring (daily): task generation -> aggregation -> radar
      try {
        const dailyDue = due24h(state.last_task_generation_at);
        if (daemon && dailyDue) {
          const { generateTasksOnce } = await import('../tasks/taskGenerator.mjs');
          const gen = await generateTasksOnce({ workspace_path: ws, node_id: h, cadence: '24h', max_per_run: 3 }).catch(() => null);
          if (gen && gen.ok) state.last_task_generation_at = nowIso();
          await saveRuntimeState({ state_path, state }).catch(() => null);
        }

        const aggDue = due24h(state.last_experience_aggregation_at);
        if (daemon && aggDue) {
          const { aggregateExperience } = await import('../experience/experienceAggregator.mjs');
          const agg = await aggregateExperience({ workspace_path: ws, window: 'last_24h' }).catch(() => null);
          if (agg && agg.ok) {
            const outAgg = path.join(ws, 'data', 'experience_aggregate.latest.json');
            await writeJsonAtomic(outAgg, agg);
            state.last_experience_aggregation_at = nowIso();
            await saveRuntimeState({ state_path, state }).catch(() => null);

            const { generateRadar } = await import('../observability/radarGenerator.mjs');
            const radar = await generateRadar({ aggregate: agg }).catch(() => null);
            if (radar && radar.ok) {
              const outRadar = path.join(ws, 'data', 'radar.latest.json');
              await writeJsonAtomic(outRadar, radar);
              state.last_radar_generation_at = nowIso();
              await saveRuntimeState({ state_path, state }).catch(() => null);

              // Minimal radar delivery via OpenClaw CLI (best-effort, once per 24h)
              const deliverDue = due24h(state.last_radar_delivery_at);
              if (deliverDue) {
                try {
                  const channel = (process.env.RADAR_DELIVERY_CHANNEL || '').trim();
                  const target = (process.env.RADAR_DELIVERY_TARGET || '').trim();
                  if (channel && target) {
                    const { createOpenClawCliSend } = await import('../social/openclawCliSend.mjs');
                    const send = createOpenClawCliSend({ openclawBin: process.env.OPENCLAW_BIN || 'openclaw' });
                    const lines = (radar.stories || []).map((s) => `- ${String(s.story || '').trim()}`).filter(Boolean);
                    const msg = [`Daily Radar (${radar.date || ''})`, ...lines].join('\n');
                    await send({ gateway: channel, channel_id: target, message: msg });
                    state.last_radar_delivery_at = nowIso();
                    state.first_radar_sent = true;
                    await saveRuntimeState({ state_path, state }).catch(() => null);
                  }
                } catch {}
              }
            }
          }
        }
      } catch {}

      // A) discover peers (every 30s)
      const peerDue = !state.last_peer_refresh_at || (Date.now() - Date.parse(state.last_peer_refresh_at)) >= 30000;
      if (peerDue) {
        const disc = await discoverPeers({ workspace_path: ws, directory_base_url: directory, relay_local_http: relay });
        if (disc.ok) {
          const peers_path = getPeersPath({ workspace_path: ws });
          await savePeers({ peers_path, table: disc.table });
          state.last_peer_refresh_at = nowIso();
        }
      }

      // Peer gossip (every 30s, best-effort)
      const gossipDue = peerDue;
      if (daemon && gossipDue) {
        try {
          const peers_path = getPeersPath({ workspace_path: ws });
          const loadedPeers = await (await import('../peers/peerStore.mjs')).loadPeers({ peers_path });
          const known = Array.isArray(loadedPeers.table?.peers) ? loadedPeers.table.peers : [];
          const peersList = known.map((p) => ({ node_id: p.peer_id, relay: p?.endpoints?.relay_url || 'wss://bootstrap.a2a.fun/relay', last_seen: p?.liveness?.last_seen || null }));

          const toList = Array.isArray(gossip_peers) ? gossip_peers : [];
          for (const to of toList) {
            const tid = String(to || '').trim();
            if (!tid || tid === h) continue;
            await sendPeerGossip({ relayUrl, from_node_id: h, to_node_id: tid, peers: peersList }).catch(() => null);
          }
        } catch {}
      }

      // B) sync tasks (every 10s) + task sync protocol (every 60s)
      const taskDue = !state.last_task_sync_at || (Date.now() - Date.parse(state.last_task_sync_at)) >= 10000;
      const tasks_path = getTasksPath({ workspace_path: ws });
      const loaded = await loadTasks({ tasks_path });
      state.last_task_sync_at = nowIso();

      const syncDue = !state.last_task_sync_request_at || (Date.now() - Date.parse(state.last_task_sync_request_at)) >= 60000;
      if (daemon && syncDue && task_sync_peer_id) {
        await sendTaskSyncRequest({ relayUrl, from_node_id: h, to_node_id: String(task_sync_peer_id), limit: 50 }).catch(() => null);
        state.last_task_sync_request_at = nowIso();
      }

      // C) pick task (capability-aware)
      const caps = await loadNodeCapabilities({ workspace_path: ws });
      const matcher = (task) => taskMatchesCapabilities({ task, capabilities: caps.capabilities });

      const picked = pickOldestPublished(loaded.table.tasks, matcher);
      if (!picked) {
        console.log(JSON.stringify({ ok: true, event: 'AGENT_LOOP_IDLE', mode, holder: h, reason: 'NO_PUBLISHED_TASK' }));
        await saveRuntimeState({ state_path, state });
        return { idle: true, reason: 'NO_PUBLISHED_TASK' };
      }

      // Claim fairness: jitter + recent-work delay
      const jitterMs = 100 + Math.floor(Math.random() * 701); // 100..800
      console.log(JSON.stringify({ ok: true, event: 'TASK_CLAIM_JITTER_APPLIED', mode, holder: h, task_id: picked.task_id, jitter_ms: jitterMs }));
      await sleep(jitterMs);

      const lastExec = state.last_task_executed_at ? Date.parse(state.last_task_executed_at) : NaN;
      if (Number.isFinite(lastExec)) {
        const agoMs = Date.now() - lastExec;
        if (agoMs >= 0 && agoMs < 5000) {
          const extra = 400 + Math.floor(Math.random() * 401); // 400..800
          console.log(JSON.stringify({ ok: true, event: 'TASK_CLAIM_DELAYED_RECENT_WORK', mode, holder: h, task_id: picked.task_id, extra_delay_ms: extra, last_task_executed_at: state.last_task_executed_at }));
          await sleep(extra);
        }
      }

      state.last_task_pick_at = nowIso();
      console.log(JSON.stringify({ ok: true, event: 'TASK_CLAIM_SELECTED', mode, holder: h, task_id: picked.task_id }));
      console.log(JSON.stringify({ ok: true, event: 'AGENT_LOOP_TASK_PICKED', mode, holder: h, task_id: picked.task_id }));

      // D) accept + execute
      const acc = await acceptTask({ tasks_path, task_id: picked.task_id, holder: h });
      if (!acc.ok) {
        // Another node may have claimed it first; treat as benign contention.
        console.log(JSON.stringify({ ok: true, event: 'AGENT_LOOP_IDLE', mode, holder: h, reason: 'TASK_ALREADY_CLAIMED', task_id: picked.task_id, error: acc.error }));
        await saveRuntimeState({ state_path, state });
        return { idle: true, reason: 'TASK_ALREADY_CLAIMED' };
      }

      // Announce claim to peers so they don't execute the same task.
      try {
        const afterAcc = await loadTasks({ tasks_path });
        const claimed = afterAcc.table.tasks.find((t) => t.task_id === picked.task_id) || null;
        const lease = claimed?.lease || { holder: h, expires_at: null };
        const peersToAnnounce = Array.isArray(claim_announce_peers) ? claim_announce_peers : [];
        for (const peer of peersToAnnounce) {
          const to = String(peer || '').trim();
          if (!to || to === h) continue;
          await sendTaskAccepted({ relayUrl, from_node_id: h, to_node_id: to, task_id: picked.task_id, lease }).catch(() => null);
        }
      } catch {}

      // Re-check ownership before executing (claim protocol)
      {
        const cur = await loadTasks({ tasks_path });
        const curTask = cur.table.tasks.find((t) => t.task_id === picked.task_id) || null;
        if (curTask && String(curTask.assigned_to || '').trim() && String(curTask.assigned_to || '').trim() !== h) {
          console.log(JSON.stringify({ ok: true, event: 'TASK_EXECUTION_SKIPPED_NOT_CLAIM_OWNER', task_id: picked.task_id, assigned_to: curTask.assigned_to }));
          await saveRuntimeState({ state_path, state });
          return { idle: true, reason: 'NOT_CLAIM_OWNER' };
        }
      }

      // Dedup guard: skip execution if already completed with matching fingerprint
      const guard = shouldSkipExecution({ task: picked });
      if (guard.ok && guard.skip) {
        console.log(JSON.stringify({ ok: true, event: 'TASK_EXECUTION_SKIPPED_DUPLICATE', task_id: picked.task_id, fingerprint: guard.fingerprint }));
      } else {
        await markRunning({ tasks_path, task_id: picked.task_id });

        let execRes = null;
        try {
          execRes = await executeTask({ task: picked, relay_local_http: relay });
          if (execRes && execRes.ok) {
            // persist fingerprint + result_hash
            picked.fingerprint = picked.fingerprint || guard.fingerprint || null;
            picked.result_hash = execRes.result_hash || null;
            await completeTask({ tasks_path, task_id: picked.task_id, result: execRes });
          } else {
            await failTask({ tasks_path, task_id: picked.task_id, error: execRes?.error || { code: 'EXEC_FAILED' } });
          }
        } catch (e) {
          await failTask({ tasks_path, task_id: picked.task_id, error: { code: 'EXEC_THROW', message: String(e?.message || e) } });
        }
      }

      // If this task originated from a remote creator, send result back (best-effort)
      const creator = String(picked.created_by || '').trim();
      if (creator && creator !== h) {
        const afterLocal = await loadTasks({ tasks_path });
        const finalLocal = afterLocal.table.tasks.find((t) => t.task_id === picked.task_id) || null;
        await sendTaskResult({
          relayUrl,
          from_peer_id: h,
          to_peer_id: creator,
          task_id: picked.task_id,
          final_status: finalLocal?.status || null,
          result: finalLocal?.result || null,
          error: finalLocal?.error || null
        }).catch(() => null);
      }

      state.last_task_executed_at = nowIso();
      await saveRuntimeState({ state_path, state });

      const after = await loadTasks({ tasks_path });
      const final = after.table.tasks.find((t) => t.task_id === picked.task_id) || null;

      console.log(JSON.stringify({ ok: true, event: 'AGENT_LOOP_TASK_COMPLETED', mode, holder: h, task_id: picked.task_id, final_status: final?.status || null }));

      // Peer graph stats: update self execution counters
      await recordTaskExecuted({ workspace_path: ws, node_id: h, at: nowIso() }).catch(() => null);

      return { idle: false, task_id: picked.task_id, final_status: final?.status || null };
    } catch (e) {
      console.log(JSON.stringify({ ok: false, event: 'AGENT_LOOP_ERROR', mode, holder: h, error: { message: String(e?.message || e) } }));
      return { idle: true, reason: 'ERROR' };
    }
  };

  // ONCE mode
  if (!daemon) {
    const r = await doOneTick();
    return r.idle
      ? { ok: true, mode, holder: h, idle: true, reason: r.reason, runtime_state_path: state_path }
      : { ok: true, mode, holder: h, picked_task_id: r.task_id, final_status: r.final_status, runtime_state_path: state_path };
  }

  // DAEMON mode
  while (true) {
    const r = await doOneTick();
    if (r.idle) await sleep(rand(1000, 3000));
  }

}
