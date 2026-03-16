#!/usr/bin/env node
import { buildExperienceGraph } from '../src/experience/buildExperienceGraph.mjs';

const out = await buildExperienceGraph({ workspace_path: process.env.A2A_WORKSPACE_PATH || process.cwd() });

if (!out.ok) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  topics_count: out.topics_count,
  records_count: out.records_count,
  graph_path: out.graph_path
}, null, 2));
