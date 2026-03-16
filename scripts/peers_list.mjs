#!/usr/bin/env node
import { getPeersPath, loadPeers } from '../src/peers/peerStore.mjs';
import { listPeers } from '../src/peers/listPeers.mjs';
import { resolvePeer } from '../src/peers/resolvePeer.mjs';

function parseArgs(argv) {
  const out = { only_targetable: false, resolve: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only-targetable') out.only_targetable = true;
    else if (a === '--resolve') out.resolve = argv[++i] || null;
  }
  return out;
}

const args = parseArgs(process.argv);
const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();
const peers_path = getPeersPath({ workspace_path });

const loaded = await loadPeers({ peers_path });
const listed = listPeers({ table: loaded.table, only_targetable: args.only_targetable });

const out = {
  ok: true,
  peers_path,
  updated_at: loaded.table.updated_at || null,
  counts: listed.counts,
  peers: listed.peers.map((p) => ({
    peer_id: p.peer_id,
    on_relay: !!p?.liveness?.on_relay,
    relay_session_id: p?.liveness?.relay_session_id || null,
    last_seen: p?.liveness?.last_seen || null,
    directory: p?.source?.directory ? { base_url: p.source.directory.base_url, agent_id: p.source.directory.agent_id } : null,
    skills: p?.capabilities?.skills || []
  }))
};

if (args.resolve) {
  out.resolved = resolvePeer({ table: loaded.table, requested_peer_id: args.resolve });
}

console.log(JSON.stringify(out, null, 2));
