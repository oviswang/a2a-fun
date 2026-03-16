#!/usr/bin/env node
import { queryExperienceGraph } from '../src/experience/queryExperienceGraph.mjs';

function parseArgs(argv) {
  const out = { topic: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--topic') out.topic = argv[++i] || null;
  }
  return out;
}

const args = parseArgs(process.argv);
const out = await queryExperienceGraph({
  topic: args.topic,
  workspace_path: process.env.A2A_WORKSPACE_PATH || process.cwd()
});

if (!out.ok) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  topic: out.topic,
  records_count: out.records_count,
  knowledge: out.knowledge
}, null, 2));
