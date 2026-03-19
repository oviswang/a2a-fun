import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { createTaskOffer } from '../src/market/taskOffer.mjs';
import { shouldAcceptOffer } from '../src/market/offerDecision.mjs';
import { routeOfferWithFallback } from '../src/routing/openOfferRouter.mjs';
import { __resetMarketForTests } from '../src/market/taskDecision.mjs';
import { emitValueForTaskSuccess, getValue, rebuildValueIndex } from '../src/value/value.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-offer-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('publisher can create explicit offer; expected_value defaults to 1', () => {
  const out = createTaskOffer({ task_type: 'runtime_status', payload: {} });
  assert.equal(out.ok, true);
  assert.ok(out.offer.offer_id);
  assert.equal(out.offer.expected_value, 1);
});

test('node can accept/reject offers explicitly (low_value vs ok) and unsupported', async () => {
  await withTempDir(async (dataDir) => {
    __resetMarketForTests({ dataDir });

    const unsupported = shouldAcceptOffer({ offer_id: 'o1', task_type: 'unknown', expected_value: 10 }, { node_id: 'n1', dataDir, reputation_score: 0 });
    assert.equal(unsupported.accepted, false);
    assert.equal(unsupported.reason, 'unsupported');

    const low = shouldAcceptOffer({ offer_id: 'o2', task_type: 'runtime_status', expected_value: 0.5 }, { node_id: 'n1', dataDir, reputation_score: 0 });
    assert.equal(low.accepted, false);
    assert.equal(low.reason, 'low_value');

    const ok = shouldAcceptOffer({ offer_id: 'o3', task_type: 'runtime_status', expected_value: 2 }, { node_id: 'n1', dataDir, reputation_score: 0 });
    assert.equal(ok.accepted, true);
  });
});

test('fallback works and accepted offer executes and writes value ledger with offer.expected_value', async () => {
  await withTempDir(async (dataDir) => {
    __resetMarketForTests({ dataDir });

    const sid = 'sid-publisher';

    const offer = createTaskOffer({ task_type: 'runtime_status', expected_value: 3, source_super_identity_id: sid, payload: {}, timeout_ms: 1000 }).offer;

    const candidates = [{ node_id: 'n1' }, { node_id: 'n2' }];

    const out = await routeOfferWithFallback({
      candidates,
      offer,
      maxAttempts: 2,
      sendOfferFn: async ({ candidate, offer }) => {
        if (candidate.node_id === 'n1') return { offer_id: offer.offer_id, accepted: false, reason: 'low_value' };
        return { offer_id: offer.offer_id, accepted: true };
      },
      executeFn: async ({ offer }) => {
        // simulate successful task execution and value emission
        const ev = emitValueForTaskSuccess({ super_identity_id: sid, context: { source_sid: 'system', expected_value: offer.expected_value }, dataDir });
        return { ok: true, value_event_id: ev.event.event_id };
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.selected.node_id, 'n2');

    const v = getValue(sid, { dataDir }).value;
    assert.equal(v.total_value, 3);

    // rebuild matches ledger
    const rb = rebuildValueIndex({ dataDir });
    assert.equal(rb.ok, true);
    const v2 = getValue(sid, { dataDir }).value;
    assert.equal(v2.total_value, 3);
  });
});
