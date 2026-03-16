#!/usr/bin/env node
import { createTask } from '../src/tasks/taskSchema.mjs';
import { scheduleBestPeer } from '../src/tasks/taskScheduler.mjs';
import { selectCapablePeers } from '../src/tasks/taskRouting.mjs';
import { sendTaskPublished } from '../src/tasks/taskTransport.mjs';

function parseArgs(argv) {
  const out = {
    relayUrl: 'wss://bootstrap.a2a.fun/relay',
    holder: process.env.NODE_ID || process.env.A2A_AGENT_ID || 'local',
    type: 'run_check',
    topic: 'relay',
    created_by: 'local',
    requires: null,
    input: {}
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--relayUrl') out.relayUrl = argv[++i] || out.relayUrl;
    else if (a === '--holder') out.holder = argv[++i] || out.holder;
    else if (a === '--type') out.type = argv[++i] || out.type;
    else if (a === '--topic') out.topic = argv[++i] || out.topic;
    else if (a === '--created-by') out.created_by = argv[++i] || out.created_by;
    else if (a === '--requires') out.requires = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--question') out.input.question = argv[++i] || '';
    else if (a === '--url') out.input.url = argv[++i] || '';
    else if (a === '--check') out.input.check = argv[++i] || 'relay_health';
  }
  return out;
}

const args = parseArgs(process.argv);
const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();

const made = createTask({ type: args.type, topic: args.topic, created_by: args.created_by, input: args.input });
if (!made.ok) {
  console.log(JSON.stringify(made, null, 2));
  process.exit(1);
}
if (Array.isArray(args.requires) && args.requires.length > 0) made.task.requires = args.requires;

// Scheduler: select best single node
let selected = null;
try {
  const sch = await scheduleBestPeer({ workspace_path, requires: made.task.requires });
  selected = sch.ok ? sch.selected : null;
  if (selected) {
    console.log(JSON.stringify({ ok: true, event: 'TASK_SCHEDULER_SELECTED_NODE', requires: made.task.requires || null, selected }, null, 2));
    await sendTaskPublished({ relayUrl: args.relayUrl, from_peer_id: args.holder, to_peer_id: selected.peer_id, task: made.task }).catch(() => null);
    process.exit(0);
  }
} catch {}

// Fallback: capability broadcast
const sel = await selectCapablePeers({ workspace_path, requires: made.task.requires });
const targets = sel.ok && sel.peers.length > 0 ? sel.peers.map((p) => p.peer_id) : ['*'];

console.log(JSON.stringify({ ok: true, event: 'TASK_ROUTED_TO_CAPABLE_PEERS', mode: 'broadcast_fallback', requires: made.task.requires || null, targets }, null, 2));

// broadcast fallback is implemented as sending to every known peer in peers.json
const { getPeersPath, loadPeers } = await import('../src/peers/peerStore.mjs');
const peers_path = getPeersPath({ workspace_path });
const loaded = await loadPeers({ peers_path });
const peers = Array.isArray(loaded.table?.peers) ? loaded.table.peers : [];
for (const p of peers) {
  const to = String(p.peer_id || '').trim();
  if (!to) continue;
  await sendTaskPublished({ relayUrl: args.relayUrl, from_peer_id: args.holder, to_peer_id: to, task: made.task }).catch(() => null);
}
