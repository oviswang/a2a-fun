import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { evaluateAndEvolveStrategy, loadStrategyState } from '../src/strategy/evolution.mjs';
import { shouldAcceptTask, __resetMarketForTests } from '../src/market/taskDecision.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-evolve-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('strategy evolution: underperformance triggers micro threshold adjustment; params take effect; cooldown prevents oscillation; rollback restores', async () => {
  await withTempDir(async (dataDir) => {
    __resetMarketForTests({ dataDir });

    const sid = 'sid-node';

    // Seed local earnings underperformance trend
    await fs.writeFile(
      path.join(dataDir, 'earnings_analytics.json'),
      JSON.stringify(
        {
          ok: true,
          updated_at: new Date().toISOString(),
          analytics: {
            [sid]: {
              total_reward: 10,
              credited_events: 5,
              reward_by_task_type: { runtime_status: 10 },
              reward_by_channel: { pull: 10 },
              trend: { reward_last_24h: 5, reward_prev_24h: 10 }
            }
          }
        },
        null,
        2
      ) + '\n'
    );

    // Seed market snapshot showing higher-threshold strategies perform better
    await fs.writeFile(
      path.join(dataDir, 'strategy_market_snapshot.json'),
      JSON.stringify(
        {
          ok: true,
          updated_at: new Date().toISOString(),
          by_strategy_type: [
            { strategy_type: 'conservative', sids: 1, total_reward: 100, total_volume: 50, avg_reward_per_task: 2.0, avg_win_rate: 0.6, avg_threshold: 3.0 },
            { strategy_type: 'aggressive', sids: 1, total_reward: 10, total_volume: 10, avg_reward_per_task: 1.0, avg_win_rate: 0.4, avg_threshold: 1.0 }
          ]
        },
        null,
        2
      ) + '\n'
    );

    // Seed local profile avg_threshold lower than best
    await fs.writeFile(
      path.join(dataDir, 'strategy_profiles.json'),
      JSON.stringify(
        {
          ok: true,
          updated_at: new Date().toISOString(),
          profiles: [
            {
              sid,
              strategy_type: 'aggressive',
              avg_threshold: 1.0,
              avg_reward_per_task: 2.0,
              total_reward: 10,
              win_rate: 0.5,
              pickup_rate: 0.5,
              task_focus: ['runtime_status'],
              channel_focus: ['pull'],
              last_updated: new Date().toISOString()
            }
          ]
        },
        null,
        2
      ) + '\n'
    );

    // Ensure state file exists (auto-init)
    const st0 = loadStrategyState({ dataDir });
    assert.equal(st0.current_params.threshold_adjustment, 0);

    const t0 = shouldAcceptTask(
      { expected_value: 1.0, reputation_score: 0, task_type: 'runtime_status', channel: 'pull', node_super_identity_id: sid },
      { node_id: 'n1', dataDir }
    );
    assert.equal(t0.detail.formula.local_threshold_adjustment, 0);

    const now0 = Date.now();
    const evo1 = evaluateAndEvolveStrategy({ sid, dataDir, nowMs: now0 });
    assert.equal(evo1.action, 'applied');

    const st1 = loadStrategyState({ dataDir, autoInit: false });
    assert.equal(st1.current_params.threshold_adjustment, 0.1);

    const t1 = shouldAcceptTask(
      { expected_value: 1.0, reputation_score: 0, task_type: 'runtime_status', channel: 'pull', node_super_identity_id: sid },
      { node_id: 'n1', dataDir }
    );
    assert.equal(t1.detail.formula.local_threshold_adjustment, 0.1);

    // cooldown: repeated run in same window should noop
    const evo2 = evaluateAndEvolveStrategy({ sid, dataDir, nowMs: now0 + 60_000 });
    assert.equal(evo2.action, 'noop');
    assert.equal(evo2.reason, 'cooldown');

    // Force evaluation window passed + performance worsened -> rollback
    const stForce = loadStrategyState({ dataDir, autoInit: false });
    // Make it look old enough
    stForce.pending_evaluation.applied_at = new Date(now0 - 7 * 3600 * 1000).toISOString();
    // Also ensure cooldown not blocking
    stForce.last_adjustment_at = new Date(now0 - 7 * 3600 * 1000).toISOString();
    await fs.writeFile(path.join(dataDir, 'strategy_state.json'), JSON.stringify(stForce, null, 2) + '\n');

    // worsen earnings
    const earn = JSON.parse(await fs.readFile(path.join(dataDir, 'earnings_analytics.json'), 'utf8'));
    earn.analytics[sid].trend.reward_last_24h = 1;
    await fs.writeFile(path.join(dataDir, 'earnings_analytics.json'), JSON.stringify(earn, null, 2) + '\n');

    const evo3 = evaluateAndEvolveStrategy({ sid, dataDir, nowMs: now0 });
    assert.equal(evo3.action, 'rollback');

    const st2 = loadStrategyState({ dataDir, autoInit: false });
    assert.equal(st2.current_params.threshold_adjustment, 0);
  });
});

test('strategy evolution: underperformance triggers micro weight adjustment (task/channel) and takes effect in decision weights', async () => {
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
            [sid]: {
              total_reward: 10,
              credited_events: 5,
              reward_by_task_type: { runtime_status: 10 },
              reward_by_channel: { pull: 10 },
              trend: { reward_last_24h: 5, reward_prev_24h: 10 }
            }
          }
        },
        null,
        2
      ) + '\n'
    );

    // market snapshot exists but avg_threshold equal -> no threshold proposal
    await fs.writeFile(
      path.join(dataDir, 'strategy_market_snapshot.json'),
      JSON.stringify(
        {
          ok: true,
          updated_at: new Date().toISOString(),
          by_strategy_type: [
            { strategy_type: 'balanced', sids: 1, total_reward: 10, total_volume: 10, avg_reward_per_task: 1.0, avg_win_rate: 0.5, avg_threshold: 1.0 }
          ]
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
          updated_at: new Date().toISOString(),
          profiles: [
            {
              sid,
              strategy_type: 'balanced',
              avg_threshold: 1.0,
              avg_reward_per_task: 2.0,
              total_reward: 10,
              win_rate: 0.5,
              pickup_rate: 0.5,
              task_focus: ['runtime_status'],
              channel_focus: ['pull'],
              last_updated: new Date().toISOString()
            }
          ]
        },
        null,
        2
      ) + '\n'
    );

    loadStrategyState({ dataDir });

    const evo = evaluateAndEvolveStrategy({ sid, dataDir, nowMs: Date.now() });
    assert.equal(evo.action, 'applied');

    const st = loadStrategyState({ dataDir, autoInit: false });
    assert.equal(st.current_params.task_weights.runtime_status, 1.05);

    const d = shouldAcceptTask(
      { expected_value: 1.0, reputation_score: 0, task_type: 'runtime_status', channel: 'pull', node_super_identity_id: sid },
      { node_id: 'n1', dataDir }
    );

    // preference weights should reflect local override (capped)
    assert.ok(d.detail.preference_weight_task >= 1.0);
  });
});
