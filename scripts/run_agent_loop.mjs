#!/usr/bin/env node
import { runLoop } from '../src/runtime/agentRuntimeLoop.mjs';

function parseArgs(argv) {
  const out = { once: false, daemon: false, holder: null, relay: 'http://127.0.0.1:18884', directory: 'https://bootstrap.a2a.fun', relayUrl: 'wss://bootstrap.a2a.fun/relay', taskSyncPeer: null, claimAnnouncePeers: null, gossipPeers: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--once') out.once = true;
    else if (a === '--daemon') out.daemon = true;
    else if (a === '--holder') out.holder = argv[++i] || null;
    else if (a === '--relay') out.relay = argv[++i] || out.relay;
    else if (a === '--directory') out.directory = argv[++i] || out.directory;
    else if (a === '--relayUrl') out.relayUrl = argv[++i] || out.relayUrl;
    else if (a === '--task-sync-peer') out.taskSyncPeer = argv[++i] || null;
    else if (a === '--claim-announce-peers') out.claimAnnouncePeers = (argv[++i] || '').split(',').map(s=>s.trim()).filter(Boolean);
    else if (a === '--gossip-peers') out.gossipPeers = (argv[++i] || '').split(',').map(s=>s.trim()).filter(Boolean);
  }
  return out;
}

const args = parseArgs(process.argv);
const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();

// v0.1 stable node identity: persist NODE_ID under workspace data/node_id
try {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  const p = path.join(workspace_path, 'data', 'node_id');
  await fs.mkdir(path.dirname(p), { recursive: true });

  const existing = await fs.readFile(p, 'utf8').catch(() => null);
  const stable = existing && String(existing).trim() ? String(existing).trim() : null;

  let nodeId = (process.env.NODE_ID || process.env.A2A_AGENT_ID || '').trim();
  if (!nodeId && stable) nodeId = stable;

  if (nodeId && !stable) {
    await fs.writeFile(p, nodeId + '\n', 'utf8');
  }

  if (!nodeId && stable) nodeId = stable;

  if (nodeId) {
    process.env.NODE_ID = nodeId;
    process.env.A2A_AGENT_ID = nodeId;
  }
} catch {}

const out = await runLoop({
  workspace_path,
  once: args.once,
  daemon: args.daemon,
  holder: args.holder,
  relay: args.relay,
  directory: args.directory,
  relayUrl: args.relayUrl,
  task_sync_peer_id: args.taskSyncPeer,
  claim_announce_peers: args.claimAnnouncePeers,
  gossip_peers: args.gossipPeers
});

console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
