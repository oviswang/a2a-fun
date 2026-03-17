import { getTasksPath, loadTasks, publishTask, saveTasks } from '../../tasks/taskStore.mjs';
import { validateTask, nowIso } from '../../tasks/taskSchema.mjs';
import { taskMatchesCapabilities } from '../nodeCapabilities.mjs';

function log(event, fields = {}) {
  console.log(JSON.stringify({ ok: true, event, ts: nowIso(), ...fields }));
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
  known_peers = []
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

    // Dedup: only send once
    t.meta = t.meta && typeof t.meta === 'object' ? t.meta : {};
    t.meta.task_publish_sent = t.meta.task_publish_sent === true ? true : false;
    if (t.meta.task_publish_sent) continue;

    if (!toList.length) continue;

    const targets = toList.slice(0, 50);
    log('TASK_PUBLISH_BROADCAST', { node_id, task_id: t.task_id, peer_count: targets.length });

    let sentOk = 0;

    for (const to of targets) {
      const payload = {
        task_id: t.task_id,
        type: t.type,
        topic: t.topic,
        created_by: t.created_by,
        input: t.input
      };

      const tx = send({ to, topic: 'task.publish', payload });
      if (tx?.ok) {
        sentOk++;
        log('TASK_PUBLISH_SENT', { node_id, task_id: t.task_id, to });
      } else {
        log('TASK_PUBLISH_SENT', { node_id, task_id: t.task_id, to, warning: 'send_failed' });
      }
    }

    // Only mark as sent if at least one target accepted the send.
    if (sentOk > 0) {
      t.meta.task_publish_sent = true;
      await saveTasks({ tasks_path, table: loaded.table });
    }
  }

  // 2) task.result outbound: tasks executed by this node where created_by is remote.
  for (const t of tasks) {
    if (!t) continue;
    const created_by = String(t.created_by || '').trim();
    if (!created_by || created_by === node_id) continue;

    if (t.status !== 'completed' && t.status !== 'failed') continue;

    t.meta = t.meta && typeof t.meta === 'object' ? t.meta : {};
    if (t.meta.task_result_sent === true) continue;

    const payload = {
      task_id: t.task_id,
      executed_by: node_id,
      status: t.status,
      result: t.status === 'completed' ? t.result : { ok: false, error: t.error || { code: 'FAILED' } }
    };

    const tx = send({ to: created_by, topic: 'task.result', payload });
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
      }
    }

    // Decide eligibility (for local execution loop). We do NOT claim here.
    // Claim must be emitted only when this node actually accepts the task (lease holder),
    // otherwise we'd fake remote behavior.
    const match = taskMatchesCapabilities({ task: t, capabilities });
    if (!match?.match) return { ok: true, eligible: false, reason: 'ineligible' };

    // Arbitration visibility: eligible nodes record that they will compete.
    log('TASK_CLAIM_ATTEMPT', { node_id, task_id, claimed_by: node_id });

    return { ok: true, eligible: true };
  }

  if (topic === 'task.claim') {
    const p = payload && typeof payload === 'object' ? payload : {};
    const task_id = String(p.task_id || '').trim();
    log('TASK_CLAIM_RECEIVED', { node_id, task_id, from });

    const loaded = await loadTasks({ tasks_path });
    const t = loaded.table.tasks.find((x) => x && x.task_id === task_id) || null;
    if (t) {
      const prevStatus = String(t.status || '').trim() || null;
      const prevAssigned = String(t.assigned_to || '').trim() || null;
      const nextAssigned = String(p.claimed_by || from || '').trim() || null;

      t.status = 'accepted';
      t.assigned_to = nextAssigned;
      t.lease = t.lease && typeof t.lease === 'object' ? t.lease : { holder: null, expires_at: null };
      t.lease.holder = t.assigned_to;
      t.lease.expires_at = p.lease_until || t.lease.expires_at || null;
      t.meta = t.meta && typeof t.meta === 'object' ? t.meta : {};
      t.meta.claim_received_from = from;
      await saveTasks({ tasks_path, table: loaded.table });

      if (prevAssigned === node_id && nextAssigned && nextAssigned !== node_id) {
        log('TASK_CLAIM_LOST', { node_id, task_id, claimed_by: nextAssigned });
      } else if (prevStatus === 'published' && nextAssigned && nextAssigned !== node_id) {
        log('TASK_EXECUTION_SKIPPED_LOST_CLAIM', { node_id, task_id, claimed_by: nextAssigned });
      }
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
