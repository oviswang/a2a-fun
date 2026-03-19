import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldAcceptTask, withInflight } from '../src/market/taskDecision.mjs';
import { routeTaskWithFallback } from '../src/routing/taskMarketRouter.mjs';

test('shouldAcceptTask rejects low expected_value', () => {
  const prev = process.env.A2A_MIN_EXPECTED_VALUE;
  process.env.A2A_MIN_EXPECTED_VALUE = '2';
  try {
    const d = shouldAcceptTask({ expected_value: 1 }, { node_id: 'n1' });
    assert.equal(d.accepted, false);
    assert.equal(d.reason, 'low_value');
  } finally {
    process.env.A2A_MIN_EXPECTED_VALUE = prev;
  }
});

test('shouldAcceptTask rejects when overloaded', async () => {
  const prev = process.env.A2A_MAX_INFLIGHT;
  process.env.A2A_MAX_INFLIGHT = '0';
  try {
    const d = shouldAcceptTask({ expected_value: 1 }, { node_id: 'n1' });
    assert.equal(d.accepted, false);
    assert.equal(d.reason, 'overloaded');
  } finally {
    process.env.A2A_MAX_INFLIGHT = prev;
  }

  // sanity: withInflight increments and decrements
  await withInflight(async () => {
    // no-op
  });
});

test('routeTaskWithFallback tries next candidate on reject and stops on accept', async () => {
  const candidates = [{ node_id: 'n1' }, { node_id: 'n2' }, { node_id: 'n3' }];
  const out = await routeTaskWithFallback({
    candidates,
    taskPayload: { expected_value: 1 },
    maxAttempts: 3,
    sendFn: async ({ candidate }) => {
      if (candidate.node_id === 'n1') return { accepted: false, reason: 'low_value' };
      if (candidate.node_id === 'n2') return { accepted: true, reason: 'ok', response: { ok: true } };
      return { accepted: true, reason: 'ok' };
    }
  });

  assert.equal(out.ok, true);
  assert.equal(out.selected.node_id, 'n2');
  assert.equal(out.attempts.length, 2);
});
