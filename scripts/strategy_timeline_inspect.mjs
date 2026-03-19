#!/usr/bin/env node

import { getStrategyTimeline, getStrategyEffectiveness } from '../src/analytics/strategyTimeline.mjs';

function parseArgs(argv) {
  const out = { mode: 'history', sid: null, limit: 50 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') out.mode = String(argv[++i] || 'history');
    else if (a === '--limit') out.limit = Number(argv[++i] || 50);
    else if (!out.sid) out.sid = String(a);
  }
  return out;
}

const { mode, sid, limit } = parseArgs(process.argv);

if (!sid) {
  process.stderr.write('Usage: node scripts/strategy_timeline_inspect.mjs sid-... --mode history|effectiveness|insights [--limit 50]\n');
  process.exit(2);
}

if (mode === 'history') {
  const out = await getStrategyTimeline({ sid, limit });
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

if (mode === 'effectiveness') {
  const out = await getStrategyEffectiveness({ sid });
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

if (mode === 'insights') {
  const tl = await getStrategyTimeline({ sid, limit: 5000 });
  const events = tl.events;

  const adjustments = new Map();
  for (const e of events) {
    if (e.event_type === 'strategy_adjustment') adjustments.set(e.event_id, e);
  }

  const byType = new Map();
  for (const e of events) {
    if (e.event_type !== 'strategy_evaluation') continue;
    const adj = adjustments.get(e.linked_event_id);
    const t = adj?.adjustment?.type || 'unknown';
    if (!byType.has(t)) byType.set(t, { type: t, pos: [], neg: [] });
    const b = byType.get(t);
    const delta = Number(e.after_reward) - Number(e.before_reward);
    if (Number.isFinite(delta)) {
      if (delta >= 0) b.pos.push(delta);
      else b.neg.push(delta);
    }
  }

  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const rows = [...byType.values()].map((x) => ({
    type: x.type,
    avg_positive_delta: avg(x.pos),
    avg_negative_delta: avg(x.neg),
    samples: x.pos.length + x.neg.length
  }));

  const best = [...rows].sort((a, b) => (b.avg_positive_delta - a.avg_positive_delta))[0] || null;
  const worst = [...rows].sort((a, b) => (a.avg_negative_delta - b.avg_negative_delta))[0] || null;

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        sid,
        best_adjustment_type: best?.type || null,
        worst_adjustment_type: worst?.type || null,
        avg_positive_delta: best?.avg_positive_delta || 0,
        avg_negative_delta: worst?.avg_negative_delta || 0,
        breakdown: rows
      },
      null,
      2
    ) + '\n'
  );
  process.exit(0);
}

process.stderr.write('Unknown mode\n');
process.exit(2);
