#!/usr/bin/env node

import {
  traceEconomicPathByRewardEvent,
  traceEconomicPathByValueEvent,
  traceEconomicPathByOffer
} from '../src/analytics/economicTrace.mjs';

import fs from 'node:fs';
import path from 'node:path';

function readJsonlTail(p, maxLines = 5000) {
  try {
    const s = fs.readFileSync(p, 'utf8');
    const lines = s.split('\n').filter(Boolean);
    return lines.slice(-maxLines).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function parseArgs(argv) {
  const out = {
    human: false,
    with_backfill: false,
    show_confidence: false,
    offer_id: null,
    value_event_id: null,
    reward_event_id: null,
    sid: null,
    recent: 5
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--human') out.human = true;
    else if (a === '--with-backfill') out.with_backfill = true;
    else if (a === '--show-confidence') out.show_confidence = true;
    else if (a === '--offer-id') out.offer_id = String(argv[++i] || '').trim() || null;
    else if (a === '--value-event-id') out.value_event_id = String(argv[++i] || '').trim() || null;
    else if (a === '--reward-event-id') out.reward_event_id = String(argv[++i] || '').trim() || null;
    else if (a === '--sid') out.sid = String(argv[++i] || '').trim() || null;
    else if (a === '--recent') out.recent = Number(argv[++i] || 5);
  }
  return out;
}

function humanPrint(trace, { showConfidence = false } = {}) {
  const s = trace?.summary;
  const k = s?.trace_keys || {};

  const extra = [];
  if (showConfidence) {
    extra.push(`- trace_status: ${trace?.trace_status || 'n/a'}`);
    extra.push(`- inferred_links_used: ${String(!!trace?.inferred_links_used)}`);
    extra.push(`- confidence: ${trace?.confidence || 'n/a'}`);
  }

  const lines = [
    'Economic Trace Inspect (v0.6.8)',
    `- status: ${s?.status || 'unknown'} breakpoint=${s?.breakpoint || 'n/a'}`,
    `- offer_id: ${k.offer_id || 'n/a'}`,
    `- value_event_id: ${k.value_event_id || 'n/a'}`,
    `- reward_event_id: ${k.reward_event_id || 'n/a'}`,
    `- winner_sid: ${k.winner_super_identity_id || 'n/a'}`,
    `- source_sid: ${k.source_super_identity_id || 'n/a'}`,
    `- task_id: ${k.task_id || 'n/a'}`,
    `- missing: ${(s?.missing || []).join(', ') || 'none'}`
  ];

  process.stdout.write([...lines, ...extra].join('\n') + '\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const ws = process.env.A2A_WORKSPACE_PATH ? String(process.env.A2A_WORKSPACE_PATH).trim() : process.cwd();

  const backfill = (() => {
    if (!args.with_backfill) return null;
    try {
      const raw = fs.readFileSync(path.join(ws, 'data', 'trace_backfill.json'), 'utf8');
      return JSON.parse(String(raw || ''));
    } catch {
      return null;
    }
  })();

  // Single-trace modes
  if (args.offer_id) {
    const t = traceEconomicPathByOffer(args.offer_id, { dataDir: path.join(ws, 'data'), backfill });
    if (args.human) return void humanPrint(t, { showConfidence: args.show_confidence });
    return void process.stdout.write(JSON.stringify(t, null, 2) + '\n');
  }

  if (args.value_event_id) {
    const t = traceEconomicPathByValueEvent(args.value_event_id, { dataDir: path.join(ws, 'data'), backfill });
    if (args.human) return void humanPrint(t, { showConfidence: args.show_confidence });
    return void process.stdout.write(JSON.stringify(t, null, 2) + '\n');
  }

  if (args.reward_event_id) {
    const t = traceEconomicPathByRewardEvent(args.reward_event_id, { dataDir: path.join(ws, 'data'), backfill });
    if (args.human) return void humanPrint(t, { showConfidence: args.show_confidence });
    return void process.stdout.write(JSON.stringify(t, null, 2) + '\n');
  }

  // Recent-by-sid mode
  if (args.sid) {
    const sid = args.sid;
    const rewardLedger = path.join(ws, 'data', 'reward_ledger.jsonl');
    const events = readJsonlTail(rewardLedger, 200000).filter((e) => e?.event_type === 'reward_credit' && e?.super_identity_id === sid);
    const last = events.slice(-Math.max(1, Number(args.recent) || 5));

    const traces = last.map((ev) => traceEconomicPathByRewardEvent(ev.event_id, { dataDir: path.join(ws, 'data'), backfill }));

    const out = { ok: true, mode: 'sid_recent', sid, recent: last.length, traces };
    if (!args.human) return void process.stdout.write(JSON.stringify(out, null, 2) + '\n');

    process.stdout.write(`Economic Trace Inspect (v0.6.8) sid=${sid} recent=${last.length}\n`);
    for (const t of traces) {
      const s = t?.summary;
      process.stdout.write(`- reward_event_id=${s?.trace_keys?.reward_event_id || 'n/a'} status=${s?.status} breakpoint=${s?.breakpoint || 'n/a'} offer_id=${s?.trace_keys?.offer_id || 'n/a'}\n`);
    }
    return;
  }

  process.stderr.write(
    [
      'Usage:',
      '  node scripts/economic_trace_inspect.mjs --offer-id <id> [--human]',
      '  node scripts/economic_trace_inspect.mjs --value-event-id <id> [--human]',
      '  node scripts/economic_trace_inspect.mjs --reward-event-id <id> [--human]',
      '  node scripts/economic_trace_inspect.mjs --sid <sid> --recent 5 [--human]'
    ].join('\n') + '\n'
  );
  process.exit(2);
}

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + '\n');
  process.exit(1);
});
