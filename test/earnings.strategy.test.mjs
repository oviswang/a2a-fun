import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { shouldAcceptTask, __resetMarketForTests } from '../src/market/taskDecision.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-strategy-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('earnings-aware strategy: threshold adjusts with earnings trend and preferences weight effective value', async () => {
  await withTempDir(async (dataDir) => {
    __resetMarketForTests({ dataDir });

    const sid = 'sid-node';
    const analyticsPath = path.join(dataDir, 'earnings_analytics.json');
    await fs.writeFile(
      analyticsPath,
      JSON.stringify(
        {
          ok: true,
          updated_at: new Date().toISOString(),
          analytics: {
            [sid]: {
              reward_by_task_type: { runtime_status: 80, other: 20 },
              reward_by_channel: { pull: 90, whatsapp: 10 },
              trend: { reward_last_24h: 10, reward_prev_24h: 5 }
            }
          }
        },
        null,
        2
      ) + '\n'
    );

    const d = shouldAcceptTask(
      { expected_value: 1, reputation_score: 0, task_type: 'runtime_status', channel: 'pull', node_super_identity_id: sid },
      { node_id: 'n1', dataDir }
    );

    assert.equal(d.detail.formula.threshold_adjustment, 0.2);
    assert.ok(d.detail.preference_weight_task > 1.0);
    assert.ok(d.detail.preference_weight_channel > 1.0);
    assert.ok(d.detail.effective_expected_value > d.detail.original_expected_value);
  });
});

test('earnings-aware strategy: threshold decreases when earnings drop', async () => {
  await withTempDir(async (dataDir) => {
    __resetMarketForTests({ dataDir });

    const sid = 'sid-node';
    await fs.writeFile(
      path.join(dataDir, 'earnings_analytics.json'),
      JSON.stringify(
        {
          ok: true,
          updated_at: new Date().toISOString(),
          analytics: {
            [sid]: { trend: { reward_last_24h: 1, reward_prev_24h: 5 }, reward_by_task_type: {}, reward_by_channel: {} }
          }
        },
        null,
        2
      ) + '\n'
    );

    const d = shouldAcceptTask(
      { expected_value: 1, reputation_score: 0, task_type: 'x', channel: 'pull', node_super_identity_id: sid },
      { node_id: 'n1', dataDir }
    );

    assert.equal(d.detail.formula.threshold_adjustment, -0.2);
  });
});
