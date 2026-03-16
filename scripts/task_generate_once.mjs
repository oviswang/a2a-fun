#!/usr/bin/env node
import { generateTasksOnce } from '../src/tasks/taskGenerator.mjs';

function parseArgs(argv) {
  const out = {
    holder: process.env.NODE_ID || process.env.A2A_AGENT_ID || null,
    workspace: process.env.A2A_WORKSPACE_PATH || process.cwd(),
    topics: null,
    max: 3
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--holder') out.holder = argv[++i] || out.holder;
    else if (a === '--workspace') out.workspace = argv[++i] || out.workspace;
    else if (a === '--topics') out.topics = argv[++i] || null;
    else if (a === '--max') out.max = parseInt(argv[++i] || '3', 10);
  }
  return out;
}

const args = parseArgs(process.argv);
const res = await generateTasksOnce({
  workspace_path: args.workspace,
  node_id: args.holder,
  topics_path: args.topics,
  cadence: '24h',
  max_per_run: args.max
});

console.log(JSON.stringify(res, null, 2));
