#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const out = { topic: null, graph_path: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--topic') out.topic = argv[++i] || null;
    else if (a === '--graph-path') out.graph_path = argv[++i] || null;
  }
  return out;
}

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function uniq(list) {
  const out = [];
  const seen = new Set();
  for (const s of list) {
    const v = safeStr(s);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

async function readJson(p) {
  const txt = await fs.readFile(p, 'utf8');
  return JSON.parse(txt);
}

const args = parseArgs(process.argv);
const ws = process.env.A2A_WORKSPACE_PATH || process.cwd();
const graph_path = args.graph_path ? safeStr(args.graph_path) : path.join(ws, 'data', 'experience_graph.json');
const topic = safeStr(args.topic);

if (!topic) {
  console.log(JSON.stringify({ ok: false, error: { code: 'MISSING_TOPIC' } }, null, 2));
  process.exit(2);
}

let graph = null;
try {
  graph = await readJson(graph_path);
} catch {
  console.log(JSON.stringify({ ok: false, error: { code: 'GRAPH_NOT_FOUND', graph_path } }, null, 2));
  process.exit(1);
}

const bucket = graph?.topics?.[topic];
const records = Array.isArray(bucket?.records) ? bucket.records : [];

const what_worked = uniq(records.flatMap((r) => Array.isArray(r?.what_worked) ? r.what_worked : []));
const what_failed = uniq(records.flatMap((r) => Array.isArray(r?.what_failed) ? r.what_failed : []));
const tools_workflow = uniq(records.flatMap((r) => Array.isArray(r?.tools_workflow) ? r.tools_workflow : []));
const next_step = uniq(records.flatMap((r) => Array.isArray(r?.next_step) ? r.next_step : []));

const human_summary = {
  topic,
  records_count: records.length,
  what_worked,
  what_failed,
  tools_workflow,
  next_step
};

console.log(JSON.stringify({
  ok: true,
  topic,
  graph_path,
  records,
  summary: human_summary
}, null, 2));
