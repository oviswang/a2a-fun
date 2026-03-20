#!/usr/bin/env node

// v0.6.6 stabilization: reward-flow breakpoint diagnostics (derived-only)

import fs from 'node:fs/promises';
import path from 'node:path';

import { rebuildMarketMetrics } from '../src/market/offerFeed.mjs';

function nowIso() {
  return new Date().toISOString();
}

async function readJsonlCount(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return raw.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

function classify({ offers_created, offers_accepted, offers_executed, value_events_count, reward_credits_count }) {
  if (offers_created <= 0) return { stalled: false, likely_breakpoint: null, likely_cause: 'no_market_activity' };
  if (reward_credits_count > 0) return { stalled: false, likely_breakpoint: null, likely_cause: null };

  if (offers_accepted <= 0) return { stalled: true, likely_breakpoint: 'accept', likely_cause: 'no_accepted_offers' };
  if (offers_executed <= 0) return { stalled: true, likely_breakpoint: 'execute', likely_cause: 'accepted_but_not_executed' };
  if (value_events_count <= 0) return { stalled: true, likely_breakpoint: 'value', likely_cause: 'executed_but_no_value_events' };
  return { stalled: true, likely_breakpoint: 'reward', likely_cause: 'value_present_but_reward_credit_missing' };
}

function parseArgs(argv) {
  const out = { human: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--human') out.human = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const ws = process.env.A2A_WORKSPACE_PATH ? String(process.env.A2A_WORKSPACE_PATH).trim() : process.cwd();

  const mm = rebuildMarketMetrics();
  const m = mm.metrics || {};

  const offers_created = Number(m.total_offers || 0);
  const offers_accepted = Number(m.accepted_offers || 0);
  const offers_executed = Number(m.executed_offers || 0);

  const value_events_count = await readJsonlCount(path.join(ws, 'data', 'value_ledger.jsonl'));
  const reward_credits_count = await readJsonlCount(path.join(ws, 'data', 'reward_ledger.jsonl'));

  const cls = classify({ offers_created, offers_accepted, offers_executed, value_events_count, reward_credits_count });

  const out = {
    ok: true,
    generated_at: nowIso(),
    counters: {
      offers_created,
      offers_accepted,
      offers_executed,
      value_events_count,
      reward_credits_count
    },
    trace_path: ['offer', 'accept', 'execute', 'value', 'reward'],
    stalled: cls.stalled,
    likely_breakpoint: cls.likely_breakpoint,
    likely_cause: cls.likely_cause
  };

  if (!args.human) {
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }

  const lines = [
    'Reward Pipeline Observability (v0.6.6)',
    `- generated_at: ${out.generated_at}`,
    `- offers_created: ${offers_created}`,
    `- offers_accepted: ${offers_accepted}`,
    `- offers_executed: ${offers_executed}`,
    `- value_events_count: ${value_events_count}`,
    `- reward_credits_count: ${reward_credits_count}`,
    `- stalled: ${String(out.stalled)}`,
    `- likely_breakpoint: ${out.likely_breakpoint || 'n/a'}`,
    `- likely_cause: ${out.likely_cause || 'n/a'}`
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + '\n');
  process.exit(1);
});
