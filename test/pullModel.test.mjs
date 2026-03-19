import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { createTaskOffer } from '../src/market/taskOffer.mjs';
import { discoverRecentOffers, attemptPickupOffers } from '../src/market/pullModel.mjs';
import { __resetMarketForTests } from '../src/market/taskDecision.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-pull-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function readJsonl(p) {
  try {
    const s = await fs.readFile(p, 'utf8');
    return s.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

test('node can discover offers and pick up one; executed offers are not picked again', async () => {
  await withTempDir(async (dataDir) => {
    __resetMarketForTests({ dataDir });

    const offer = createTaskOffer({
      task_type: 'runtime_status',
      expected_value: 2,
      source_super_identity_id: 'sid-pub',
      dataDir
    }).offer;

    const disc1 = discoverRecentOffers({ limit: 10, dataDir });
    assert.equal(disc1.ok, true);
    assert.ok(disc1.offers.find((o) => o.offer_id === offer.offer_id));

    const p1 = await attemptPickupOffers({ node_id: 'node-1', node_super_identity_id: 'sid-node', dataDir, maxAttemptsPerCycle: 3 });
    assert.equal(p1.ok, true);
    assert.equal(p1.picked, true);

    const disc2 = discoverRecentOffers({ limit: 10, dataDir });
    assert.equal(disc2.ok, true);
    assert.ok(!disc2.offers.find((o) => o.offer_id === offer.offer_id));

    // second pickup should not pick again
    const p2 = await attemptPickupOffers({ node_id: 'node-1', node_super_identity_id: 'sid-node', dataDir, maxAttemptsPerCycle: 3 });
    assert.equal(p2.ok, true);
    assert.equal(p2.picked, false);

    // ensure offer_executed exists
    const feedPath = path.join(dataDir, 'offer_feed.jsonl');
    const evs = await readJsonl(feedPath);
    assert.ok(evs.find((e) => e.offer_id === offer.offer_id && e.event_type === 'offer_executed'));
    // interest signal emitted
    assert.ok(evs.find((e) => e.offer_id === offer.offer_id && e.event_type === 'offer_interest'));
  });
});
