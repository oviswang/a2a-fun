import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { createTaskOffer } from '../src/market/taskOffer.mjs';
import { routeOfferWithFallback } from '../src/routing/openOfferRouter.mjs';
import { rebuildMarketMetrics } from '../src/market/offerFeed.mjs';
import { __resetMarketForTests } from '../src/market/taskDecision.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-offerfeed-test-'));
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

test('offer lifecycle events recorded in offer_feed and metrics rebuildable', async () => {
  await withTempDir(async (dataDir) => {
    __resetMarketForTests({ dataDir });

    const offer = createTaskOffer({ task_type: 'runtime_status', expected_value: 2, source_super_identity_id: 'sid-src', dataDir }).offer;

    const out = await routeOfferWithFallback({
      candidates: [{ node_id: 'n1' }, { node_id: 'n2' }],
      offer,
      maxAttempts: 2,
      dataDir,
      sendOfferFn: async ({ candidate, offer }) => {
        if (candidate.node_id === 'n1') return { offer_id: offer.offer_id, accepted: false, reason: 'low_value' };
        return { offer_id: offer.offer_id, accepted: true };
      },
      executeFn: async () => ({ ok: true })
    });

    assert.equal(out.ok, true);

    const feedPath = path.join(dataDir, 'offer_feed.jsonl');
    const evs = await readJsonl(feedPath);

    const types = new Set(evs.map((e) => e.event_type));
    assert.ok(types.has('offer_created'));
    assert.ok(types.has('offer_sent'));
    assert.ok(types.has('offer_rejected'));
    assert.ok(types.has('offer_accepted'));
    assert.ok(types.has('offer_executed'));

    const m = rebuildMarketMetrics({ dataDir }).metrics;
    assert.equal(m.total_offers, 1);
    assert.equal(m.accepted_offers, 1);
    assert.equal(m.rejected_offers, 1);
    assert.equal(m.executed_offers, 1);
    assert.ok(m.avg_expected_value > 0);
  });
});
