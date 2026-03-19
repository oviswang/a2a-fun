import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { shouldAcceptTask, withInflight, loadMarketState, saveMarketState, __resetMarketForTests } from '../src/market/taskDecision.mjs';
import { routeTaskWithFallback } from '../src/routing/taskMarketRouter.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-market-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('adaptive pricing: overloaded node raises threshold (overload_penalty)', async () => {
  await withTempDir(async (dataDir) => {
    __resetMarketForTests({ dataDir });

    const prevMax = process.env.A2A_MAX_INFLIGHT;
    process.env.A2A_MAX_INFLIGHT = '100'; // avoid hard reject

    try {
      // Hold 3 inflight tasks.
      let release;
      const wait = new Promise((r) => (release = r));
      const p1 = withInflight(() => wait);
      const p2 = withInflight(() => wait);
      const p3 = withInflight(() => wait);

      const d = shouldAcceptTask({ expected_value: 2, reputation_score: 0 }, { node_id: 'n1', dataDir });
      assert.equal(d.accepted, true);
      assert.ok(d.detail.current_threshold > 1);

      release();
      await Promise.all([p1, p2, p3]);
    } finally {
      process.env.A2A_MAX_INFLIGHT = prevMax;
    }
  });
});

test('adaptive pricing: idle node lowers threshold and can accept low-value work', async () => {
  await withTempDir(async (dataDir) => {
    __resetMarketForTests({ dataDir });

    // Ensure no accepted history.
    const st = loadMarketState({ dataDir }).state;
    st.current_threshold = 1;
    st.last_accepted_at = null;
    saveMarketState(st, { dataDir });

    const d = shouldAcceptTask({ expected_value: 0.7, reputation_score: 0 }, { node_id: 'n1', dataDir });
    assert.equal(d.accepted, true);
    assert.ok(d.detail.current_threshold <= 1);
  });
});

test('adaptive pricing: higher reputation increases selectivity (reputation_bonus)', async () => {
  await withTempDir(async (dataDir) => {
    __resetMarketForTests({ dataDir });
    const st = loadMarketState({ dataDir }).state;
    st.current_threshold = 1;
    st.last_accepted_at = null;
    saveMarketState(st, { dataDir });

    const low = shouldAcceptTask({ expected_value: 1, reputation_score: 0 }, { node_id: 'n1', dataDir });

    const st2 = loadMarketState({ dataDir }).state;
    st2.current_threshold = 1;
    st2.last_accepted_at = null;
    saveMarketState(st2, { dataDir });

    const high = shouldAcceptTask({ expected_value: 1, reputation_score: 6 }, { node_id: 'n1', dataDir });

    assert.ok(high.detail.current_threshold > low.detail.current_threshold);
  });
});

test('routing fallback helper still works (reject then accept)', async () => {
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
