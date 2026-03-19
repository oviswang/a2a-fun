import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { createTaskOffer } from '../src/market/taskOffer.mjs';
import { attemptPickupOffers } from '../src/market/pullModel.mjs';
import { appendOfferFeedEvent } from '../src/market/offerFeed.mjs';
import { __resetMarketForTests } from '../src/market/taskDecision.mjs';
import { getValue } from '../src/value/value.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-compete-test-'));
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

test('light competition: multiple attempts, only one executed accepted, loser discards and no value written', async () => {
  await withTempDir(async (dataDir) => {
    __resetMarketForTests({ dataDir });

    const pubSid = 'sid-pub';
    const offer = createTaskOffer({ task_type: 'runtime_status', expected_value: 2, source_super_identity_id: pubSid, dataDir }).offer;

    // Node A attempts pickup, but loses because another node executes first (simulated in hook)
    const out = await attemptPickupOffers({
      node_id: 'node-A',
      node_super_identity_id: 'sid-nodeA',
      dataDir,
      beforeFinalizeHook: async ({ offer_id }) => {
        // simulate winner execution appearing right before A finalizes
        appendOfferFeedEvent(
          {
            offer_id,
            event_type: 'offer_executed',
            task_type: offer.task_type,
            expected_value: offer.expected_value,
            source_super_identity_id: pubSid,
            target_node_id: 'node-B',
            target_super_identity_id: 'sid-nodeB'
          },
          { dataDir }
        );
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.picked, false);

    const v = getValue(pubSid, { dataDir }).value;
    assert.equal(v, null); // loser didn't write value

    const evs = await readJsonl(path.join(dataDir, 'offer_feed.jsonl'));
    assert.ok(evs.find((e) => e.offer_id === offer.offer_id && e.event_type === 'offer_execution_attempt'));
    assert.ok(evs.find((e) => e.offer_id === offer.offer_id && e.event_type === 'offer_execution_lost'));

    // Winner execution exists (simulated)
    const executed = evs.filter((e) => e.offer_id === offer.offer_id && e.event_type === 'offer_executed');
    assert.ok(executed.length >= 1);
  });
});
