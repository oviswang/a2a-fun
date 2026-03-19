#!/usr/bin/env node

import { readLearningLedger, rebuildLearningInsights } from '../src/analytics/learningNetwork.mjs';

function parseArgs(argv) {
  const out = { mode: 'network', sid: null, limit: 50, json: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') out.mode = String(argv[++i] || 'network');
    else if (a === '--limit') out.limit = Number(argv[++i] || 50);
    else if (a === '--human') out.json = false;
    else if (!out.sid) out.sid = String(a);
  }
  return out;
}

const { mode, sid, limit, json } = parseArgs(process.argv);

const insights = await rebuildLearningInsights();
const events = await readLearningLedger();

if (mode === 'sid') {
  if (!sid) {
    process.stderr.write('Usage: node scripts/learning_inspect.mjs sid-... --mode sid [--limit 50]\n');
    process.exit(2);
  }
  const mine = events.filter((e) => e.super_identity_id === sid).slice(-limit);
  const summary = insights.per_sid[sid] || null;
  const out = { ok: true, mode: 'sid', sid, summary, events: mine };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

if (mode === 'propagation') {
  const out = {
    ok: true,
    mode: 'propagation',
    edges: insights.global.edges,
    note: 'Edges are sid→sid when candidate_reference_sid is known; otherwise sid→type:<strategy_type>'
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

// network
if (json) {
  const out = { ok: true, mode: 'network', global: insights.global, per_sid: insights.per_sid };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
} else {
  const g = insights.global;
  const types = Object.entries(g.strategy_type_imitated_counts || {}).sort((a, b) => b[1] - a[1]);
  process.stdout.write(
    [
      `ok=true mode=network`,
      `total_references=${g.total_references}`,
      `total_evaluations=${g.total_evaluations}`,
      `most_imitated_strategy_type=${types[0]?.[0] || 'n/a'} (${types[0]?.[1] || 0})`
    ].join('\n') + '\n'
  );
}
