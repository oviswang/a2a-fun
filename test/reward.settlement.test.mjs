import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { createTaskOffer } from '../src/market/taskOffer.mjs';
import { attemptPickupOffers } from '../src/market/pullModel.mjs';
import { __resetMarketForTests } from '../src/market/taskDecision.mjs';
import { getRewardBalance, rebuildRewardBalance, creditReward } from '../src/reward/reward.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-reward-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('winner gets reward credit from final value; balance increases; rebuild matches', async () => {
  await withTempDir(async (dataDir) => {
    __resetMarketForTests({ dataDir });

    createTaskOffer({ task_type: 'runtime_status', expected_value: 2, source_super_identity_id: 'sid-pub', dataDir });

    const out = await attemptPickupOffers({ node_id: 'node-1', node_super_identity_id: 'sid-winner', dataDir });
    assert.equal(out.ok, true);
    assert.equal(out.picked, true);

    const bal = getRewardBalance('sid-winner', { dataDir }).balance;
    assert.ok(bal);
    assert.equal(bal.balance, 2);
    assert.equal(bal.credited_events, 1);

    const rb = rebuildRewardBalance({ dataDir });
    assert.equal(rb.ok, true);

    const bal2 = getRewardBalance('sid-winner', { dataDir }).balance;
    assert.equal(bal2.balance, 2);
    assert.equal(bal2.credited_events, 1);
  });
});

test('anti-duplicate: same offer_id + winner sid credited only once', async () => {
  await withTempDir(async (dataDir) => {
    const sid = 'sid-winner';

    const c1 = creditReward({ super_identity_id: sid, amount: 1, context: { offer_id: 'offer-1', value_event_id: 'evt-1' } }, { dataDir });
    assert.equal(c1.ok, true);
    assert.equal(c1.credited, true);

    const c2 = creditReward({ super_identity_id: sid, amount: 1, context: { offer_id: 'offer-1', value_event_id: 'evt-1' } }, { dataDir });
    assert.equal(c2.ok, true);
    assert.equal(c2.credited, false);
    assert.equal(c2.reason, 'duplicate_credit');

    const bal = getRewardBalance(sid, { dataDir }).balance;
    assert.equal(bal.balance, 1);
    assert.equal(bal.credited_events, 1);
  });
});
