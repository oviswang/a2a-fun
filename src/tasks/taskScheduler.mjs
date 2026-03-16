import { selectCapablePeers } from './taskRouting.mjs';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

export async function scheduleBestPeer({ workspace_path, requires } = {}) {
  const sel = await selectCapablePeers({ workspace_path, requires });
  if (!sel.ok) return { ok: false, error: sel.error || { code: 'SELECT_FAILED' } };

  // selectCapablePeers currently returns only {peer_id, relay_url}; reload full peer records for stats
  const { getPeersPath, loadPeers } = await import('../peers/peerStore.mjs');
  const peers_path = getPeersPath({ workspace_path });
  const loaded = await loadPeers({ peers_path });
  const peers = Array.isArray(loaded.table?.peers) ? loaded.table.peers : [];

  const candidates = [];
  for (const p of peers) {
    const id = safeStr(p?.peer_id);
    if (!id) continue;
    if (!sel.peers.some((x) => x.peer_id === id)) continue;

    const n = Number(p?.stats?.tasks_executed || 0);
    candidates.push({
      peer_id: id,
      relay_url: safeStr(p?.endpoints?.relay_url) || 'wss://bootstrap.a2a.fun/relay',
      tasks_executed: Number.isFinite(n) ? n : 0
    });
  }

  candidates.sort((a, b) => (a.tasks_executed - b.tasks_executed) || a.peer_id.localeCompare(b.peer_id));

  if (candidates.length === 0) return { ok: true, selected: null, candidates: [] };
  return { ok: true, selected: candidates[0], candidates };
}
