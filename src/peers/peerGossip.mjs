import { loadPeers, savePeers, getPeersPath } from './peerStore.mjs';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function parseTs(s) {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function buildPeerGossipPayload({ node_id, relayUrl, peers } = {}) {
  const nid = safeStr(node_id);
  const relay = safeStr(relayUrl);
  const list = Array.isArray(peers) ? peers : [];

  return {
    ok: true,
    payload: {
      kind: 'A2A_PEER_GOSSIP',
      timestamp: new Date().toISOString(),
      node_id: nid || null,
      peers: list
        .map((p) => ({
          node_id: safeStr(p?.node_id || p?.peer_id),
          relay: safeStr(p?.relay || relay),
          last_seen: safeStr(p?.last_seen || p?.liveness?.last_seen) || null
        }))
        .filter((p) => p.node_id)
        .slice(0, 100)
    }
  };
}

export async function receivePeerGossip({ workspace_path, payload } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  if (!isObj(payload) || payload.kind !== 'A2A_PEER_GOSSIP') return { ok: false, error: { code: 'INVALID_PAYLOAD' } };

  console.log(JSON.stringify({ ok: true, event: 'PEER_GOSSIP_RECEIVED', from: payload.node_id || null, count: Array.isArray(payload.peers) ? payload.peers.length : 0 }));

  const peers_path = getPeersPath({ workspace_path: ws });
  const loaded = await loadPeers({ peers_path });
  const table = loaded.table;

  const map = new Map();
  for (const p of Array.isArray(table.peers) ? table.peers : []) {
    map.set(safeStr(p.peer_id), p);
  }

  let inserted = 0;
  let updated = 0;

  for (const gp of Array.isArray(payload.peers) ? payload.peers : []) {
    const id = safeStr(gp?.node_id);
    if (!id) continue;

    const seen = safeStr(gp?.last_seen) || new Date().toISOString();
    const relay = safeStr(gp?.relay) || null;

    const existing = map.get(id);
    if (!existing) {
      const rec = {
        peer_id: id,
        source: {
          directory: null,
          dht: null,
          gossip: { from: safeStr(payload.node_id) || null }
        },
        capabilities: { skills: [] },
        liveness: {
          on_relay: false,
          relay_session_id: null,
          last_seen: seen
        },
        endpoints: {
          relay_url: relay
        },
        scores: { prefer: 0 },
        notes: { last_contacted_at: null }
      };
      map.set(id, rec);
      inserted++;
      console.log(JSON.stringify({ ok: true, event: 'PEER_DISCOVERED_NEW', peer_id: id, via: 'gossip' }));
      continue;
    }

    // update last_seen if newer
    const curTs = parseTs(existing?.liveness?.last_seen);
    const inTs = parseTs(seen);
    if (inTs && (!curTs || inTs > curTs)) {
      existing.liveness = existing.liveness || {};
      existing.liveness.last_seen = seen;
      updated++;
    }

    // store relay url hint
    if (relay) {
      existing.endpoints = existing.endpoints || {};
      if (!existing.endpoints.relay_url) existing.endpoints.relay_url = relay;
    }
  }

  const peers = [...map.values()]
    .sort((a, b) => safeStr(a.peer_id).localeCompare(safeStr(b.peer_id)))
    .slice(0, 100);

  table.peers = peers;
  table.updated_at = new Date().toISOString();
  await savePeers({ peers_path, table });

  return { ok: true, inserted, updated, total: table.peers.length };
}
