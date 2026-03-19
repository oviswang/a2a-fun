#!/usr/bin/env node

import { rebuildStrategyProfiles } from '../src/analytics/strategyCompetition.mjs';
import { evaluateAndEvolveStrategy } from '../src/strategy/evolution.mjs';

const sid = String(process.argv[2] || '').trim();
if (!sid) {
  process.stderr.write('Usage: node scripts/strategy_evolve.mjs sid-...\n');
  process.exit(2);
}

// ensure derived analytics are up-to-date before evolving
rebuildStrategyProfiles();

const out = evaluateAndEvolveStrategy({ sid });
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
