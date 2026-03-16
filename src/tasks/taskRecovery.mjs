import { loadTasks, saveTasks, getTasksPath } from './taskStore.mjs';
import { getPeersPath, loadPeers } from '../peers/peerStore.mjs';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function isLeaseExpired(task) {
  const exp = safeStr(task?.lease?.expires_at);
  if (!exp) return false;
  const t = Date.parse(exp);
  return Number.isFinite(t) && t < Date.now();
}

function clearLease(task) {
  task.assigned_to = null;
  if (!task.lease || typeof task.lease !== 'object') task.lease = { holder: null, expires_at: null };
  task.lease.holder = null;
  task.lease.expires_at = null;
}

export async function recoverStuckTasks({ workspace_path } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  const tasks_path = getTasksPath({ workspace_path: ws });

  const loaded = await loadTasks({ tasks_path });
  const tasks = loaded.table.tasks;

  const peers_path = getPeersPath({ workspace_path: ws });
  const peersLoaded = await loadPeers({ peers_path });
  const peers = Array.isArray(peersLoaded.table?.peers) ? peersLoaded.table.peers : [];
  const peerMap = new Map(peers.map((p) => [safeStr(p.peer_id), p]));

  let expired = 0;
  let orphanReleased = 0;
  let recovered = 0;

  for (const t of tasks) {
    if (!t || typeof t !== 'object') continue;
    const status = safeStr(t.status);
    if (status !== 'accepted' && status !== 'running') continue;

    const assigned = safeStr(t.assigned_to);

    // 1) Lease timeout recovery
    if (isLeaseExpired(t)) {
      expired++;
      console.log(JSON.stringify({ ok: true, event: 'AGENT_TASK_LEASE_EXPIRED', task_id: t.task_id, assigned_to: assigned, expires_at: t.lease?.expires_at || null }));
      t.status = 'published';
      clearLease(t);
      recovered++;
      console.log(JSON.stringify({ ok: true, event: 'AGENT_TASK_RECOVERED', task_id: t.task_id, reason: 'lease_expired' }));
      continue;
    }

    // 2) Orphan detection
    if (assigned) {
      const p = peerMap.get(assigned) || null;
      const orphan = !p || p?.liveness?.on_relay !== true;
      if (orphan) {
        orphanReleased++;
        console.log(JSON.stringify({ ok: true, event: 'AGENT_TASK_ORPHAN_RELEASED', task_id: t.task_id, assigned_to: assigned, reason: !p ? 'peer_not_in_table' : 'peer_not_on_relay' }));
        t.status = 'published';
        clearLease(t);
        recovered++;
        console.log(JSON.stringify({ ok: true, event: 'AGENT_TASK_RECOVERED', task_id: t.task_id, reason: 'orphan' }));
      }
    }
  }

  if (recovered > 0) {
    await saveTasks({ tasks_path, table: loaded.table });
  }

  return { ok: true, tasks_path, expired, orphanReleased, recovered, total: tasks.length };
}
