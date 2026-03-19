import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { evaluateAndEvolveStrategy, loadStrategyState } from '../src/strategy/evolution.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-evolve-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('strategy evolution: applies small threshold adjustment then can rollback explicitly', async () => {
  await withTempDir(async (dataDir) => {
    const sid = 'sid-node';
    const now = Date.now();

    await fs.writeFile(
      path.join(dataDir, 'earnings_analytics.json'),
      JSON.stringify(
        {
          ok: true,
          updated_at: new Date(now).toISOString(),
          analytics: {
            [sid]: {
              reward_by_task_type: { t1: 10 },
              reward_by_channel: { pull: 10 },
              trend: { reward_last_24h: 5, reward_prev_24h: 10 }
            }
          }
        },
        null,
        2
      ) + '\n'
    );

    await fs.writeFile(
      path.join(dataDir, 'strategy_profiles.json'),
      JSON.stringify(
        {
          ok: true,
          updated_at: new Date(now).toISOString(),
          profiles: [{ sid, avg_threshold: 1.0, strategy_type: 'aggressive' }]
        },
        null,
        2
      ) + '\n'
    );

    await fs.writeFile(
      path.join(dataDir, 'strategy_market_snapshot.json'),
      JSON.stringify(
        {
          ok: true,
          updated_at: new Date(now).toISOString(),
          by_strategy_type: [
            { strategy_type: 'conservative', sids: 1, avg_reward_per_task: 5, avg_win_rate: 0.6, avg_threshold: 3.0, total_reward: 50, total_volume: 10 },
            { strategy_type: 'aggressive', sids: 1, avg_reward_per_task: 1, avg_win_rate: 0.4, avg_threshold: 1.0, total_reward: 10, total_volume: 10 }
          ]
        },
        null,
        2
      ) + '\n'
    );

    const applied = evaluateAndEvolveStrategy({ sid, dataDir, nowMs: now });
    assert.equal(applied.action, 'applied');
    assert.equal(applied.state.current_params.threshold_adjustment, 0.1);

    // force evaluation window pass and worsen performance to trigger rollback
    const st = loadStrategyState({ dataDir });
    st.pending_evaluation.applied_at = new Date(now - 7 * 3600 * 1000).toISOString();
    st.pending_evaluation.baseline_reward_last_24h = 10;
    await fs.writeFile(path.join(dataDir, 'strategy_state.json'), JSON.stringify(st, null, 2) + '\n');

    await fs.writeFile(
      path.join(dataDir, 'earnings_analytics.json'),
      JSON.stringify(
        {
          ok: true,
          updated_at: new Date(now + 8 * 3600 * 1000).toISOString(),
          analytics: { [sid]: { trend: { reward_last_24h: 5, reward_prev_24h: 10 }, reward_by_task_type: {}, reward_by_channel: {} } }
        },
        null,
        2
      ) + '\n'
    );

    const rolled = evaluateAndEvolveStrategy({ sid, dataDir, nowMs: now + 8 * 3600 * 1000 });
    assert.equal(rolled.action, 'rollback');
    assert.equal(rolled.state.current_params.threshold_adjustment, 0);
  });
});

test('strategy evolution: can adjust a task weight safely (±0.05, clamped)', async () => {
  await withTempDir(async (dataDir) => {
    const sid = 'sid-node';
    const now = Date.now();

    await fs.writeFile(
      path.join(dataDir, 'earnings_analytics.json'),
      JSON.stringify(
        {
          ok: true,
          updated_at: new Date(now).toISOString(),
          analytics: {
            [sid]: {
              reward_by_task_type: { runtime_status: 100, other: 1 },
              reward_by_channel: { pull: 10 },
              trend: { reward_last_24h: 1, reward_prev_24h: 10 }
            }
          }
        },
        null,
        2
      ) + '\n'
    );

    // no localAvgTh available => skip threshold proposal; will fall back to top task reinforcement
    await fs.writeFile(path.join(dataDir, 'strategy_market_snapshot.json'), JSON.stringify({ ok: true, updated_at: new Date(now).toISOString(), by_strategy_type: [{ strategy_type: 'balanced', sids: 1, avg_reward_per_task: 1, avg_win_rate: 0.5, avg_threshold: 2.0, total_reward: 1, total_volume: 1 }] }, null, 2) + '\n');

    const out = evaluateAndEvolveStrategy({ sid, dataDir, nowMs: now });
    assert.equal(out.action, 'applied');
    const w = out.state.current_params.task_weights.runtime_status;
    assert.equal(w, 1.05);
  });
});
