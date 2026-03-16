import { getPeersPath, loadPeers, savePeers } from './peerStore.mjs';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

export async function recordTaskExecuted({ workspace_path, node_id, at } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  const nid = safeStr(node_id);
  if (!nid) return { ok: false, error: { code: 'MISSING_NODE_ID' } };

  const peers_path = getPeersPath({ workspace_path: ws });
  const loaded = await loadPeers({ peers_path });
  const table = loaded.table;
  const peers = Array.isArray(table.peers) ? table.peers : [];

  const p = peers.find((x) => safeStr(x.peer_id) === nid) || null;
  if (!p) {
    peers.push({
      peer_id: nid,
      source: { directory: null, dht: null },
      capabilities: { skills: [] },
      liveness: { on_relay: false, relay_session_id: null, last_seen: null },
      endpoints: { relay_url: 'wss://bootstrap.a2a.fun/relay' },
      stats: { tasks_executed: 1, last_task_at: safeStr(at) || new Date().toISOString() },
      scores: { prefer: 0 },
      notes: { last_contacted_at: null }
    });
  } else {
    p.stats = p.stats && typeof p.stats === 'object' ? p.stats : { tasks_executed: 0, last_task_at: null };
    p.stats.tasks_executed = Number(p.stats.tasks_executed || 0) + 1;
    p.stats.last_task_at = safeStr(at) || new Date().toISOString();
  }

  table.peers = peers.slice(0, 100);
  table.updated_at = new Date().toISOString();
  await savePeers({ peers_path, table });

  console.log(JSON.stringify({ ok: true, event: 'PEER_STATS_UPDATED', peer_id: nid, tasks_executed: p ? p.stats.tasks_executed : 1, last_task_at: p ? p.stats.last_task_at : at }));
  return { ok: true, peers_path };
}
