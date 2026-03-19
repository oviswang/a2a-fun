#!/usr/bin/env node

import { getRewardBalance, getRecentRewardCredits } from '../src/reward/reward.mjs';

const sid = String(process.argv[2] || '').trim();
if (!sid) {
  process.stderr.write('Usage: node scripts/reward_inspect.mjs sid-...\n');
  process.exit(2);
}

const bal = getRewardBalance(sid);
const recent = getRecentRewardCredits(sid, { limit: 20 });
process.stdout.write(JSON.stringify({ ok: true, balance: bal, recent }, null, 2) + '\n');
