#!/usr/bin/env node

import { getReputation, getReputationBreakdown, getRecentReputationEvents } from '../src/reputation/reputation.mjs';

const sid = String(process.argv[2] || '').trim();
if (!sid) {
  process.stderr.write('Usage: node scripts/reputation_inspect.mjs sid-...\n');
  process.exit(2);
}

const r = getReputation(sid);
const b = getReputationBreakdown(sid);
const recent = getRecentReputationEvents(sid, { limit: 20 });
process.stdout.write(JSON.stringify({ ok: true, reputation: r, breakdown: b, recent }, null, 2) + '\n');
