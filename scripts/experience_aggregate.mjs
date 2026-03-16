#!/usr/bin/env node
import { aggregateExperience } from '../src/experience/experienceAggregator.mjs';

function parseArgs(argv) {
  const out = {
    workspace: process.env.A2A_WORKSPACE_PATH || process.cwd(),
    tasks: null,
    window: 'last_24h'
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--workspace') out.workspace = argv[++i] || out.workspace;
    else if (a === '--tasks') out.tasks = argv[++i] || null;
    else if (a === '--window') out.window = argv[++i] || out.window;
  }
  return out;
}

const args = parseArgs(process.argv);
const res = await aggregateExperience({
  workspace_path: args.workspace,
  tasks_path: args.tasks,
  window: args.window
});

console.log(JSON.stringify(res, null, 2));
