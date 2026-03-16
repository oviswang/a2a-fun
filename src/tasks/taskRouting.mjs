import { getPeersPath, loadPeers } from '../peers/peerStore.mjs';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

export async function selectCapablePeers({ workspace_path, requires } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  const reqs = Array.isArray(requires) ? requires.map(safeStr).filter(Boolean) : [];
  if (reqs.length === 0) return { ok: true, peers: [], reason: 'no_requires' };

  const peers_path = getPeersPath({ workspace_path: ws });
  const loaded = await loadPeers({ peers_path });
  const peers = Array.isArray(loaded.table?.peers) ? loaded.table.peers : [];

  const out = [];
  for (const p of peers) {
    const skills = Array.isArray(p?.capabilities?.skills) ? p.capabilities.skills : [];
    const caps = skills.map(safeStr).filter(Boolean);
    const ok = reqs.every((r) => caps.includes(r));
    if (!ok) continue;
    out.push({
      peer_id: safeStr(p.peer_id),
      relay_url: safeStr(p?.endpoints?.relay_url) || 'wss://bootstrap.a2a.fun/relay'
    });
  }

  const uniq = new Map();
  for (const p of out) {
    if (!p.peer_id) continue;
    if (uniq.has(p.peer_id)) continue;
    uniq.set(p.peer_id, p);
  }

  return { ok: true, peers: [...uniq.values()].sort((a, b) => a.peer_id.localeCompare(b.peer_id)), reason: 'matched' };
}
