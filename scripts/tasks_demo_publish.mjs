#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTask } from '../src/tasks/taskSchema.mjs';
import { getTasksPath, publishTask } from '../src/tasks/taskStore.mjs';

async function loadPeerTargets({ workspace_path } = {}) {
  try {
    const p = path.join(workspace_path, 'data', 'peer-cache.json');
    const j = JSON.parse(await fs.readFile(p, 'utf8'));
    const peers = Array.isArray(j?.peers) ? j.peers : [];
    const ids = peers.map((x) => String(x?.node_id || '').trim()).filter(Boolean);
    // de-dupe
    return Array.from(new Set(ids));
  } catch {
    return [];
  }
}

function parseArgs(argv) {
  const out = { type: 'run_check', topic: 'relay', created_by: 'local', input: {}, requires: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--type') out.type = argv[++i] || out.type;
    else if (a === '--topic') out.topic = argv[++i] || out.topic;
    else if (a === '--created-by') out.created_by = argv[++i] || out.created_by;
    else if (a === '--question') out.input.question = argv[++i] || '';
    else if (a === '--url') out.input.url = argv[++i] || '';
    else if (a === '--max-chars') out.input.max_chars = parseInt(argv[++i] || '2000', 10);
    else if (a === '--check') out.input.check = argv[++i] || 'relay_health';
    else if (a === '--requires') out.requires = (argv[++i] || '').split(',').map(s=>s.trim()).filter(Boolean);
  }
  if (out.type === 'run_check' && !out.input.check) out.input.check = 'relay_health';
  return out;
}

const args = parseArgs(process.argv);
const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();
const tasks_path = getTasksPath({ workspace_path });

const made = createTask({ type: args.type, topic: args.topic, created_by: args.created_by, input: args.input });
if (made.ok && Array.isArray(args.requires) && args.requires.length > 0) made.task.requires = args.requires;
if (!made.ok) {
  console.log(JSON.stringify(made, null, 2));
  process.exit(1);
}

// State-consistency: initialize publish_delivery ONCE at task creation using current peer-cache targets.
// This prevents ACK handler from creating a shadow delivery state.
const targets = await loadPeerTargets({ workspace_path });
made.task.meta = made.task.meta && typeof made.task.meta === 'object' ? made.task.meta : {};
made.task.meta.publish_delivery = {
  created_at: new Date().toISOString(),
  targets,
  pending_peers: targets.slice(),
  acked_peers: [],
  attempts: 0,
  last_try_at: null,
  complete: false,
  incomplete: false
};

const pub = await publishTask({ tasks_path, task: made.task });
console.log(JSON.stringify({
  ok: pub.ok,
  tasks_path,
  task: made.task
}, null, 2));
