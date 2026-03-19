#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import { getRewardBalance, getRecentRewardCredits } from '../src/reward/reward.mjs';
import { rebuildEarningsAnalytics } from '../src/analytics/earnings.mjs';

function parseArgs(argv) {
  const out = { sid: null, mode: 'summary', limit: 20 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!out.sid && a.startsWith('sid-')) out.sid = a;
    if (a === '--mode') out.mode = String(argv[++i] || 'summary');
    if (a === '--limit') out.limit = Number(argv[++i] || 20);
  }
  return out;
}

function readJsonlTail(p, maxLines = 10000) {
  try {
    const s = fs.readFileSync(p, 'utf8');
    const lines = s.split('\n').filter(Boolean);
    return lines.slice(-maxLines).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

const args = parseArgs(process.argv);
if (!args.sid) {
  process.stderr.write('Usage: node scripts/earnings_inspect.mjs sid-xxx [--mode history|breakdown|trend|summary] [--limit 20]\n');
  process.exit(2);
}

const bal = getRewardBalance(args.sid).balance;
const analytics = rebuildEarningsAnalytics().analytics.analytics[args.sid] || null;

if (args.mode === 'breakdown' || args.mode === 'trend') {
  process.stdout.write(JSON.stringify({ ok: true, sid: args.sid, balance: bal, analytics }, null, 2) + '\n');
  process.exit(0);
}

if (args.mode === 'history' || args.mode === 'summary') {
  const recent = getRecentRewardCredits(args.sid, { limit: args.limit }).events;

  // Enrich history from value_ledger + offer_feed if present
  const dataDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
  const valueLedger = path.join(dataDir, 'value_ledger.jsonl');
  const offerFeed = path.join(dataDir, 'offer_feed.jsonl');

  const values = readJsonlTail(valueLedger, 200000);
  const offers = readJsonlTail(offerFeed, 200000);

  const valueById = new Map(values.map((v) => [v.event_id, v]));
  const offerCreatedById = new Map();
  for (const e of offers) {
    if (e.event_type === 'offer_created' && e.offer_id) offerCreatedById.set(e.offer_id, e);
  }

  const enriched = recent.map((e) => {
    const ctx = e.context || {};
    const v = ctx.value_event_id ? valueById.get(ctx.value_event_id) : null;
    const o = ctx.offer_id ? offerCreatedById.get(ctx.offer_id) : null;
    return {
      ts: e.ts,
      amount: e.amount,
      offer_id: ctx.offer_id || null,
      task_id: ctx.task_id || null,
      source_super_identity_id: ctx.source_super_identity_id || null,
      expected_value: o?.expected_value ?? null,
      final_value: v?.value ?? null,
      reputation_multiplier: v?.context?.multiplier ?? null,
      channel: ctx?.metadata?.channel ?? null
    };
  });

  const summary = {
    sid: args.sid,
    current_balance: bal?.balance ?? 0,
    credited_events: bal?.credited_events ?? 0,
    lifetime_reward: analytics?.total_reward ?? (bal?.balance ?? 0),
    reward_last_24h: analytics?.trend?.reward_last_24h ?? null,
    top_task_type: analytics ? Object.entries(analytics.reward_by_task_type || {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null : null,
    avg_reward_per_task: analytics?.avg_reward_per_task ?? null,
    trend: analytics?.trend?.trend_direction ?? null
  };

  process.stdout.write(JSON.stringify({ ok: true, mode: args.mode, summary, history: enriched }, null, 2) + '\n');
  process.exit(0);
}

process.stdout.write(JSON.stringify({ ok: false, error: { code: 'UNKNOWN_MODE', mode: args.mode } }, null, 2) + '\n');
