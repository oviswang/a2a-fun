import { listPublishedAgentsRemote } from '../discovery/sharedAgentDirectoryClient.mjs';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function uniqByPeerId(peers) {
  const out = [];
  const seen = new Set();
  for (const p of peers) {
    const id = safeStr(p?.peer_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(p);
  }
  return out;
}

async function fetchRelayNodes(relay_local_http) {
  try {
    const r = await fetch(`${relay_local_http}/nodes`);
    const j = await r.json();
    return { ok: true, nodes: Array.isArray(j?.nodes) ? j.nodes : [] };
  } catch {
    return { ok: false, nodes: [] };
  }
}

export async function discoverPeers({
  workspace_path,
  directory_base_url = 'https://bootstrap.a2a.fun',
  relay_local_http = 'http://127.0.0.1:18884'
} = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();

  // 1) inventory from shared directory
  const dir = await listPublishedAgentsRemote({ base_url: directory_base_url });
  const agents = dir.ok ? dir.agents : [];

  // 2) reachability from relay
  const rel = await fetchRelayNodes(relay_local_http);
  const nodes = rel.ok ? rel.nodes : [];
  const onRelay = new Map(nodes.map((n) => [safeStr(n?.node_id), n]));

  const peers = [];

  for (const a of agents) {
    const peer_id = safeStr(a?.agent_id);
    if (!peer_id) continue;
    const live = onRelay.get(peer_id) || null;
    peers.push({
      peer_id,
      source: {
        directory: {
          base_url: directory_base_url,
          agent_id: peer_id
        },
        // reserved for later DHT upgrade
        dht: null
      },
      capabilities: {
        skills: Array.isArray(a?.skills) ? a.skills : []
      },
      liveness: {
        on_relay: !!live,
        relay_session_id: safeStr(live?.session_id) || null,
        last_seen: safeStr(live?.last_seen) || null
      },
      scores: {
        prefer: 0
      },
      notes: {
        last_contacted_at: null
      }
    });
  }

  // Relay-only nodes (reachable but not advertised in directory)
  for (const n of nodes) {
    const peer_id = safeStr(n?.node_id);
    if (!peer_id) continue;
    // skip if already added via directory
    if (peers.some((p) => p.peer_id === peer_id)) continue;
    peers.push({
      peer_id,
      source: {
        directory: null,
        dht: null
      },
      capabilities: { skills: [] },
      liveness: {
        on_relay: true,
        relay_session_id: safeStr(n?.session_id) || null,
        last_seen: safeStr(n?.last_seen) || null
      },
      scores: { prefer: 0 },
      notes: { last_contacted_at: null }
    });
  }

  const table = {
    ok: true,
    version: 'peers.v0.1',
    updated_at: new Date().toISOString(),
    workspace_path: ws,
    sources: {
      directory_base_url,
      relay_local_http
    },
    peers: uniqByPeerId(peers).sort((a, b) => a.peer_id.localeCompare(b.peer_id))
  };

  return {
    ok: true,
    table,
    stats: {
      directory_ok: dir.ok === true,
      relay_ok: rel.ok === true,
      directory_count: agents.length,
      relay_nodes_count: nodes.length,
      peers_count: table.peers.length
    }
  };
}
