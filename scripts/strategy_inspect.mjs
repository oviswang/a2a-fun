#!/usr/bin/env node

import { rebuildStrategyProfiles } from '../src/analytics/strategyCompetition.mjs';

function parseArgs(argv) {
  const out = { mode: 'global', value: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') out.mode = String(argv[++i] || 'global');
    else if (!out.value) out.value = a;
  }
  return out;
}

const { mode, value } = parseArgs(process.argv);
const rebuilt = rebuildStrategyProfiles();

const profiles = rebuilt.profiles.profiles;
const snapshot = rebuilt.snapshot;

if (mode === 'sid') {
  const sid = String(value || '').trim();
  const p = profiles.find((x) => x.sid === sid) || null;
  process.stdout.write(JSON.stringify({ ok: true, mode: 'sid', sid, profile: p, snapshot }, null, 2) + '\n');
  process.exit(0);
}

if (mode === 'strategy_type') {
  const t = String(value || '').trim();
  const xs = profiles.filter((x) => x.strategy_type === t);
  process.stdout.write(JSON.stringify({ ok: true, mode: 'strategy_type', strategy_type: t, profiles: xs, snapshot }, null, 2) + '\n');
  process.exit(0);
}

// global
const best = [...profiles].sort((a, b) => (b.avg_reward_per_task || 0) - (a.avg_reward_per_task || 0))[0] || null;
process.stdout.write(JSON.stringify({ ok: true, mode: 'global', top_performer: best, snapshot, profiles }, null, 2) + '\n');
