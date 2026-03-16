import fs from 'node:fs/promises';
import path from 'node:path';

import { discoverPeers } from '../peers/discoverPeers.mjs';
import { getPeersPath, savePeers } from '../peers/peerStore.mjs';

import { getTasksPath, loadTasks, acceptTask, markRunning, completeTask, failTask } from '../tasks/taskStore.mjs';
import { executeTask } from '../tasks/taskExecutor.mjs';
import { sendTaskResult } from '../tasks/taskTransport.mjs';

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
        current_mode: null
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

function pickOldestPublished(tasks) {
  const pub = tasks.filter((t) => t && t.status === 'published' && !leaseActive(t));
  pub.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  return pub[0] || null;
}

export async function runLoop({
  workspace_path,
  once = false,
  daemon = false,
  holder,
  relay = 'http://127.0.0.1:18884',
  directory = 'https://bootstrap.a2a.fun',
  relayUrl = 'wss://bootstrap.a2a.fun/relay'
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

  const doOneTick = async () => {
    try {
      state.last_loop_tick_at = nowIso();
      console.log(JSON.stringify({ ok: true, event: 'AGENT_LOOP_TICK', mode, holder: h, ts: state.last_loop_tick_at }));

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

      // B) sync tasks (every 10s)
      const taskDue = !state.last_task_sync_at || (Date.now() - Date.parse(state.last_task_sync_at)) >= 10000;
      const tasks_path = getTasksPath({ workspace_path: ws });
      const loaded = taskDue ? await loadTasks({ tasks_path }) : await loadTasks({ tasks_path });
      state.last_task_sync_at = nowIso();

      // C) pick task
      const picked = pickOldestPublished(loaded.table.tasks);
      if (!picked) {
        console.log(JSON.stringify({ ok: true, event: 'AGENT_LOOP_IDLE', mode, holder: h, reason: 'NO_PUBLISHED_TASK' }));
        await saveRuntimeState({ state_path, state });
        return { idle: true, reason: 'NO_PUBLISHED_TASK' };
      }

      state.last_task_pick_at = nowIso();
      console.log(JSON.stringify({ ok: true, event: 'AGENT_LOOP_TASK_PICKED', mode, holder: h, task_id: picked.task_id }));

      // D) accept + execute
      const acc = await acceptTask({ tasks_path, task_id: picked.task_id, holder: h });
      if (!acc.ok) {
        await saveRuntimeState({ state_path, state });
        return { idle: false, error: acc.error, stage: 'accept', task_id: picked.task_id };
      }

      await markRunning({ tasks_path, task_id: picked.task_id });

      let execRes = null;
      try {
        execRes = await executeTask({ task: picked, relay_local_http: relay });
        if (execRes && execRes.ok) {
          await completeTask({ tasks_path, task_id: picked.task_id, result: execRes });
        } else {
          await failTask({ tasks_path, task_id: picked.task_id, error: execRes?.error || { code: 'EXEC_FAILED' } });
        }
      } catch (e) {
        await failTask({ tasks_path, task_id: picked.task_id, error: { code: 'EXEC_THROW', message: String(e?.message || e) } });
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
