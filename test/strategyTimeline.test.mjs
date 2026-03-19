import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import {
  appendStrategyEvent,
  appendStrategyEvaluation,
  getStrategyTimeline,
  getStrategyEffectiveness
} from '../src/analytics/strategyTimeline.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-timeline-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('strategy timeline: adjustment and evaluation events append; effectiveness stats correct', async () => {
  await withTempDir(async (dataDir) => {
    const sid = 'sid-x';

    const adj = await appendStrategyEvent(
      {
        super_identity_id: sid,
        adjustment: { type: 'threshold_up', delta: 0.1, reason: 'test' },
        before: { threshold_adjustment: 0, reward_last_24h: 5, avg_reward_per_task: 1 },
        after: { threshold_adjustment: 0.1 },
        evaluation: { baseline_reward_24h: 5 }
      },
      { dataDir }
    );
    assert.equal(adj.ok, true);

    const ev1 = await appendStrategyEvaluation(
      {
        super_identity_id: sid,
        linked_event_id: adj.event_id,
        result: 'improved',
        before_reward: 5,
        after_reward: 6,
        decision: 'kept'
      },
      { dataDir }
    );
    assert.equal(ev1.ok, true);

    const ev2 = await appendStrategyEvaluation(
      {
        super_identity_id: sid,
        linked_event_id: adj.event_id,
        result: 'degraded',
        before_reward: 10,
        after_reward: 8,
        decision: 'rolled_back'
      },
      { dataDir }
    );
    assert.equal(ev2.ok, true);

    const tl = await getStrategyTimeline({ sid, limit: 10 }, { dataDir });
    assert.equal(tl.ok, true);
    assert.equal(tl.events.length, 3);

    const eff = await getStrategyEffectiveness({ sid }, { dataDir });
    assert.equal(eff.total_adjustments, 1);
    assert.equal(eff.improved, 1);
    assert.equal(eff.degraded, 1);
    assert.equal(eff.flat, 0);
    assert.equal(eff.success_rate, 0.5);
  });
});

test('strategy timeline: no crash when write fails', async () => {
  const sid = 'sid-x';
  const out = await appendStrategyEvent(
    { super_identity_id: sid, adjustment: { type: 'threshold_up', delta: 0.1, reason: 'x' } },
    { dataDir: '/dev/null' }
  );
  assert.equal(typeof out.ok, 'boolean');
});
