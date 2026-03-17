import { getTasksPath, loadTasks, publishTask, saveTasks } from '../../tasks/taskStore.mjs';
import { validateTask, nowIso } from '../../tasks/taskSchema.mjs';
import { taskMatchesCapabilities } from '../nodeCapabilities.mjs';

function log(event, fields = {}) {
  console.log(JSON.stringify({ ok: true, event, ts: nowIso(), ...fields }));
}

function parseClaimTs(v) {
  const n = typeof v === 'number' ? v : Date.parse(String(v || ''));
  return Number.isFinite(n) ? n : null;
}

function pickWinnerFromClaims(claims = []) {
  const arr = Array.isArray(claims) ? claims.filter((c) => c && c.task_id && c.claimed_by && c.claim_ts != null) : [];
  arr.sort((a, b) => {
    const ta = a.claim_ts;
    const tb = b.claim_ts;
    if (ta !== tb) return ta - tb;
    return String(a.claimed_by).localeCompare(String(b.claimed_by));
  });
  return arr[0] || null;
}

function pickOnePeer({ peers, self }) {
  const arr = Array.isArray(peers) ? peers.filter((p) => p && p.node_id && p.node_id !== self) : [];
  arr.sort((a, b) => String(a.node_id).localeCompare(String(b.node_id)));
  return arr[0] || null;
}

export async function tickTaskNetworkOutboundV0_1({
  workspace_path,
  node_id,
  bootstrap_base_url,
  send,
  capabilities = [],
  known_peers = [],
  deliveryRetryEveryMs = 400,
  deliveryMaxAttempts = 5
} = {}) {
  if (!send || typeof send !== 'function') return { ok: true, skipped: true, reason: 'no_send' };

  const tasks_path = getTasksPath({ workspace_path });
  const loaded = await loadTasks({ tasks_path });
  const tasks = loaded.table.tasks || [];

  // Determine publish targets
  // Priority:
  // 1) explicit TASK_PUBLISH_TO (backward compat)
  // 2) broadcast to known_peers (peer cache / gossip)
  // 3) fallback: choose one active peer from bootstrap
  const configuredTo = String(process.env.TASK_PUBLISH_TO || '').trim();
  let toList = configuredTo ? configuredTo.split(',').map((s) => s.trim()).filter(Boolean) : [];

  if (!toList.length && Array.isArray(known_peers) && known_peers.length) {
    toList = known_peers.map((p) => p?.node_id).filter((x) => x && x !== node_id);
  }

  if (!toList.length && bootstrap_base_url) {
    try {
      const r = await fetch(`${String(bootstrap_base_url).replace(/\/$/, '')}/peers`, { method: 'GET' });
      const j = await r.json();
      const peer = pickOnePeer({ peers: j?.peers || [], self: node_id });
      if (peer?.node_id) toList = [peer.node_id];
    } catch {}
  }

  toList = Array.from(new Set(toList));

  // 1) task.publish outbound: tasks created by this node that are still published.
  for (const t of tasks) {
    if (!t || t.status !== 'published') continue;
    if (String(t.created_by || '').trim() !== node_id) continue;

    // Reliable at-least-once broadcast delivery via publish ACK + retry
    t.meta = t.meta && typeof t.meta === 'object' ? t.meta : {};

    if (!toList.length) continue;

    const targets = toList.slice(0, 50);

    // init delivery state
    t.meta.publish_delivery = t.meta.publish_delivery && typeof t.meta.publish_delivery === 'object' ? t.meta.publish_delivery : null;
    if (!t.meta.publish_delivery) {
      t.meta.publish_delivery = {
        created_at: nowIso(),
        targets,
        pending_peers: targets.slice(),
        acked_peers: [],
        attempts: 0,
        last_try_at: null,
        complete: false,
        incomplete: false
      };

      // Mark as network-published so creator does not self-execute.
      t.meta.task_publish_sent = true;

      log('TASK_PUBLISH_BROADCAST', { node_id, task_id: t.task_id, peer_count: targets.length });
      await saveTasks({ tasks_path, table: loaded.table });
    }

    const d = t.meta.publish_delivery;
    const now = Date.now();
    const last = d.last_try_at ? Date.parse(d.last_try_at) : NaN;
    const due = !Number.isFinite(last) || (now - last) >= deliveryRetryEveryMs;

    // delivery done?
    if (Array.isArray(d.pending_peers) && d.pending_peers.length === 0) {
      if (!d.complete) {
        d.complete = true;
        log('TASK_PUBLISH_DELIVERY_COMPLETE', { node_id, task_id: t.task_id, peer_count: (d.targets || []).length });
        await saveTasks({ tasks_path, table: loaded.table });
      }
      continue;
    }

    // too many attempts?
    if (d.attempts >= deliveryMaxAttempts) {
      if (!d.incomplete) {
        d.incomplete = true;
        log('TASK_PUBLISH_DELIVERY_INCOMPLETE', { node_id, task_id: t.task_id, pending_peers: d.pending_peers || [], acked_peers: d.acked_peers || [], attempts: d.attempts });
        await saveTasks({ tasks_path, table: loaded.table });
      }
      continue;
    }

    if (!due) continue;

    d.attempts += 1;
    d.last_try_at = nowIso();

    log('TASK_PUBLISH_RETRY', { node_id, task_id: t.task_id, attempt: d.attempts, pending_count: (d.pending_peers || []).length });

    // Persist delivery state before sending, so ACK handler can always find it.
    await saveTasks({ tasks_path, table: loaded.table });

    const pending = Array.isArray(d.pending_peers) ? d.pending_peers.slice(0, 50) : [];
    for (const to of pending) {
      const payload = { task_id: t.task_id, type: t.type, topic: t.topic, created_by: t.created_by, input: t.input };
      const tx = send({ to, topic: 'task.publish', payload, message_id: `task.publish:${t.task_id}:${to}:attempt${d.attempts}` });
      if (tx?.ok) log('TASK_PUBLISH_SENT', { node_id, task_id: t.task_id, to });
      else log('TASK_PUBLISH_SENT', { node_id, task_id: t.task_id, to, warning: 'send_failed' });
    }
  }

  // 2) task.result outbound: tasks executed by this node where created_by is remote.
  for (const t of tasks) {
    if (!t) continue;
    const created_by = String(t.created_by || '').trim();
    if (!created_by || created_by === node_id) continue;

    if (t.status !== 'completed' && t.status !== 'failed') continue;

    t.meta = t.meta && typeof t.meta === 'object' ? t.meta : {};
    if (t.meta.invalid_result === true) {
      // Late-claim loser: do not emit task.result
      continue;
    }
    if (t.meta.task_result_sent === true) continue;

    const payload = {
      task_id: t.task_id,
      executed_by: node_id,
      status: t.status,
      result: t.status === 'completed' ? t.result : { ok: false, error: t.error || { code: 'FAILED' } }
    };

    const tx = send({ to: created_by, topic: 'task.result', payload, message_id: `task.result:${t.task_id}:${created_by}` });
    if (tx?.ok) {
      log('TASK_RESULT_SENT', { node_id, task_id: t.task_id, to: created_by });
      t.meta.task_result_sent = true;
      await saveTasks({ tasks_path, table: loaded.table });
    } else {
      log('TASK_RESULT_SENT', { node_id, task_id: t.task_id, to: created_by, warning: 'send_failed' });
    }
  }

  return { ok: true };
}

export async function handleTaskRelayMessageV0_1({
  workspace_path,
  node_id,
  capabilities = [],
  from,
  topic,
  payload,
  send
} = {}) {
  const tasks_path = getTasksPath({ workspace_path });

  if (topic === 'task.publish') {
    const p = payload && typeof payload === 'object' ? payload : {};
    const task_id = String(p.task_id || '').trim();

    log('TASK_PUBLISH_RECEIVED', { node_id, task_id, from });

    // Upsert task into local store (status=published)
    const loaded = await loadTasks({ tasks_path });
    const tasks = loaded.table.tasks || [];

    let t = tasks.find((x) => x && x.task_id === task_id) || null;
    if (!t) {
      t = {
        task_id,
        type: p.type,
        topic: p.topic,
        created_at: nowIso(),
        created_by: p.created_by,
        assigned_to: null,
        status: 'published',
        input: p.input && typeof p.input === 'object' ? p.input : {},
        requires: null,
        fingerprint: null,
        result: null,
        result_hash: null,
        error: null,
        lease: { holder: null, expires_at: null },
        meta: { received_from: from }
      };

      const v = validateTask(t);
      if (v.ok) {
        tasks.push(t);
        loaded.table.tasks = tasks;
        await saveTasks({ tasks_path, table: loaded.table });
      } else {
        // Minimal recovery: coerce into a valid task shape so arbitration/execution can proceed.
        log('TASK_PUBLISH_PERSIST_FAILED', { node_id, task_id, from, error: v.error || null });
        try {
          t.type = (t.type && typeof t.type === 'string') ? t.type : 'run_check';
          if (!t.topic) t.topic = String(p.topic || '').trim() || 'untitled';
          t.created_at = nowIso();
          t.created_by = String(p.created_by || from || '').trim() || from;
          t.status = 'published';
          t.input = t.input && typeof t.input === 'object' ? t.input : {};
          t.lease = t.lease && typeof t.lease === 'object' ? t.lease : { holder: null, expires_at: null };
          const v2 = validateTask(t);
          if (v2.ok) {
            tasks.push(t);
            loaded.table.tasks = tasks;
            await saveTasks({ tasks_path, table: loaded.table });
            log('TASK_PUBLISH_PERSIST_RECOVERED', { node_id, task_id, from });
          } else {
            log('TASK_CLAIM_WINDOW_SUPPRESSED', { node_id, task_id, reason: 'PERSIST_INVALID_TASK' });
          }
        } catch {
          log('TASK_CLAIM_WINDOW_SUPPRESSED', { node_id, task_id, reason: 'PERSIST_EXCEPTION' });
        }
      }
    }

    // Send publish ACK back to creator (at-least-once delivery)
    try {
      const creator = String(p.created_by || '').trim();
      if (creator && creator !== node_id && send && typeof send === 'function') {
        const ackPayload = { task_id, received_by: node_id };
        const tx = send({ to: creator, topic: 'task.publish.ack', payload: ackPayload, message_id: `task.publish.ack:${task_id}:${node_id}` });
        log('TASK_PUBLISH_ACK_SENT', { node_id, task_id, to: creator, ok: !!tx?.ok });
      }
    } catch {}

    // Decide eligibility (for local execution loop). We do NOT claim here.
    // Claim must be emitted only when this node actually accepts the task (lease holder),
    // otherwise we'd fake remote behavior.
    const match = taskMatchesCapabilities({ task: t, capabilities });
    if (!match?.match) return { ok: true, eligible: false, reason: 'ineligible' };

    // Arbitration visibility: eligible nodes record that they will compete.
    log('TASK_CLAIM_ATTEMPT', { node_id, task_id, claimed_by: node_id });

    return { ok: true, eligible: true };
  }

  if (topic === 'task.publish.ack') {
    const p = payload && typeof payload === 'object' ? payload : {};
    const task_id = String(p.task_id || '').trim();
    const received_by = String(p.received_by || from || '').trim() || null;

    log('TASK_PUBLISH_ACK_RECEIVED', { node_id, task_id, from, received_by });

    const loaded = await loadTasks({ tasks_path });
    const t = loaded.table.tasks.find((x) => x && x.task_id === task_id) || null;
    if (t) {
      t.meta = t.meta && typeof t.meta === 'object' ? t.meta : {};

      // Event-driven delivery tracking: ACK events are source of truth.
      let d = t.meta.publish_delivery && typeof t.meta.publish_delivery === 'object' ? t.meta.publish_delivery : null;

      // Lazily reconstruct delivery tracking if missing/out-of-sync.
      if (!d) {
        const configuredTo = String(process.env.TASK_PUBLISH_TO || '').trim();
        const inferredTargets = configuredTo
          ? configuredTo.split(',').map((s) => s.trim()).filter(Boolean)
          : [];

        d = {
          created_at: nowIso(),
          targets: inferredTargets,
          pending_peers: inferredTargets.slice(),
          acked_peers: [],
          attempts: 0,
          last_try_at: null,
          complete: false,
          incomplete: false
        };
        t.meta.publish_delivery = d;
      }

      if (received_by) {
        d.targets = Array.isArray(d.targets) ? d.targets : [];
        d.acked_peers = Array.isArray(d.acked_peers) ? d.acked_peers : [];
        d.pending_peers = Array.isArray(d.pending_peers) ? d.pending_peers : [];

        // If targets were unknown at init time, expand targets as we see ACKs (best-effort).
        if (!d.targets.length) {
          d.targets = [received_by];
          d.pending_peers = [received_by];
        }

        if (!d.acked_peers.includes(received_by)) d.acked_peers.push(received_by);
        d.pending_peers = d.pending_peers.filter((x) => x !== received_by);

        const targetSet = new Set(d.targets);
        const ackSet = new Set(d.acked_peers);
        let covered = true;
        for (const tid of targetSet) {
          if (!ackSet.has(tid)) { covered = false; break; }
        }

        if (covered && d.complete !== true) {
          d.complete = true;
          log('TASK_PUBLISH_DELIVERY_COMPLETE', { node_id, task_id, peer_count: d.targets.length });
        }
      }

      await saveTasks({ tasks_path, table: loaded.table });
    }

    return { ok: true };
  }

  if (topic === 'task.claim') {
    const p = payload && typeof payload === 'object' ? payload : {};
    const task_id = String(p.task_id || '').trim();
    const claimed_by = String(p.claimed_by || from || '').trim() || null;
    const claim_ts = parseClaimTs(p.claim_ts);
    const claim_id = String(p.claim_id || '').trim() || null;

    log('TASK_CLAIM_RECEIVED', { node_id, task_id, from, claimed_by, claim_ts, claim_id });

    const loaded = await loadTasks({ tasks_path });
    const t = loaded.table.tasks.find((x) => x && x.task_id === task_id) || null;
    if (t && claimed_by && claim_ts != null) {
      t.meta = t.meta && typeof t.meta === 'object' ? t.meta : {};
      const claims = Array.isArray(t.meta.claims) ? t.meta.claims : [];
      claims.push({ task_id, claimed_by, claim_ts, claim_id: claim_id || null, from: from || null, seen_at: nowIso() });
      t.meta.claims = claims;

      const winner = pickWinnerFromClaims(claims);
      if (winner?.claimed_by) {
        t.meta.claim_winner = winner.claimed_by;
        t.meta.claim_winner_ts = winner.claim_ts;
      }

      // Late-claim handling: if already running and we are not the best claim, mark invalid.
      if (String(t.status || '') === 'running' && winner?.claimed_by && winner.claimed_by !== node_id) {
        t.meta.invalid_result = true;
      }

      await saveTasks({ tasks_path, table: loaded.table });
    }

    return { ok: true };
  }

  if (topic === 'task.result') {
    const p = payload && typeof payload === 'object' ? payload : {};
    const task_id = String(p.task_id || '').trim();

    const loaded = await loadTasks({ tasks_path });
    const t = loaded.table.tasks.find((x) => x && x.task_id === task_id) || null;
    if (t) {
      t.meta = t.meta && typeof t.meta === 'object' ? t.meta : {};
      if (t.meta.task_result_received === true) {
        return { ok: true, duplicate: true };
      }

      log('TASK_RESULT_RECEIVED', { node_id, task_id, from });

      t.status = p.status || t.status;
      t.result = p.result ?? t.result;
      t.meta.result_received_from = from;
      t.meta.task_result_received = true;
      await saveTasks({ tasks_path, table: loaded.table });
      return { ok: true };
    }

    // If we don't have the task locally, still log once.
    log('TASK_RESULT_RECEIVED', { node_id, task_id, from, warning: 'task_not_found' });
    return { ok: true };
  }

  return { ok: true, ignored: true };
}
