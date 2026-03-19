#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import { rebuildMarketMetrics } from '../src/market/offerFeed.mjs';

function parseArgs(argv) {
  const out = { recent: 50, task_type: null, offer_id: null, status: null, summary: false, dataDir: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--recent') out.recent = Number(argv[++i] || 50);
    if (a === '--task_type') out.task_type = String(argv[++i] || '');
    if (a === '--offer_id') out.offer_id = String(argv[++i] || '');
    if (a === '--status') out.status = String(argv[++i] || '');
    if (a === '--summary') out.summary = true;
    if (a === '--dataDir') out.dataDir = String(argv[++i] || '');
  }
  return out;
}

function getFeedPath(dataDir) {
  const dir = dataDir || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
  return path.join(dir, 'offer_feed.jsonl');
}

function readLines(p, max = 5000) {
  try {
    const s = fs.readFileSync(p, 'utf8');
    const lines = s.split('\n').filter(Boolean);
    return lines.slice(-max);
  } catch {
    return [];
  }
}

const args = parseArgs(process.argv);

if (args.summary) {
  const m = rebuildMarketMetrics({ dataDir: args.dataDir || undefined });
  process.stdout.write(JSON.stringify({ ok: true, mode: 'summary', metrics: m.metrics }, null, 2) + '\n');
  process.exit(0);
}

const feedPath = getFeedPath(args.dataDir);
const lines = readLines(feedPath, Math.max(200, args.recent * 20));

const events = [];
for (const line of lines) {
  try {
    events.push(JSON.parse(line));
  } catch {}
}

let filtered = events;
if (args.task_type) filtered = filtered.filter((e) => e.task_type === args.task_type);
if (args.offer_id) filtered = filtered.filter((e) => e.offer_id === args.offer_id);

// Build lifecycle status per offer_id
const byOffer = new Map();
for (const e of filtered) {
  if (!e.offer_id) continue;
  const prev = byOffer.get(e.offer_id);
  if (!prev || String(e.ts) > String(prev.ts)) byOffer.set(e.offer_id, e);
}

let rows = [...byOffer.values()]
  .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
  .slice(0, Math.max(1, Number.isFinite(args.recent) ? args.recent : 50))
  .map((e) => ({
    ts: e.ts,
    offer_id: e.offer_id,
    task_type: e.task_type,
    expected_value: e.expected_value,
    status: e.event_type,
    reason: e.reason || null,
    target_node_id: e.target_node_id || null
  }));

if (args.status) rows = rows.filter((r) => r.status === args.status);

process.stdout.write(JSON.stringify({ ok: true, mode: 'recent', feedPath, count: rows.length, offers: rows }, null, 2) + '\n');
