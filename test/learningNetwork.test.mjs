import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { evaluateAndEvolveStrategy, loadStrategyState } from '../src/strategy/evolution.mjs';
import { readLearningLedger, rebuildLearningInsights } from '../src/analytics/learningNetwork.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-learn-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('learning ledger: imitation_reference written on imitation apply; imitation_evaluation written on evaluation end/rollback; insights derived', async () => {
  await withTempDir(async (dataDir) => {
    const sid = 'sid-local';

    await fs.writeFile(
      path.join(dataDir, 'earnings_analytics.json'),
      JSON.stringify(
        {
          ok: true,
          updated_at: new Date().toISOString(),
          analytics: {
            [sid]: {
              total_reward: 3,
              credited_events: 3,
              reward_by_task_type: {},
              reward_by_channel: {},
              trend: { reward_last_24h: 1, reward_prev_24h: 5 }
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
          updated_at: new Date().toISOString(),
          profiles: [
            {
              sid,
              strategy_type: 'balanced',
              avg_threshold: 1.5,
              avg_reward_per_task: 0.5,
              total_reward: 3,
              win_rate: 0.2,
              pickup_rate: 0.2,
              task_focus: ['t1'],
              channel_focus: ['pull'],
              last_updated: new Date().toISOString()
            }
          ]
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
          updated_at: new Date().toISOString(),
          by_strategy_type: [
            { strategy_type: 'conservative', sids: 3, total_reward: 100, total_volume: 50, avg_reward_per_task: 1.2, avg_win_rate: 0.6, avg_threshold: 1.5 }
          ]
        },
        null,
        2
      ) + '\n'
    );

    loadStrategyState({ dataDir });

    const out = evaluateAndEvolveStrategy({ sid, dataDir, nowMs: Date.now() });
    assert.equal(out.action, 'applied');

    await new Promise((r) => setTimeout(r, 20));

    let ev = await readLearningLedger({ dataDir });
    assert.ok(ev.find((e) => e.event_type === 'imitation_reference'));

    // Force evaluation window end + worse performance -> rollback
    const st = loadStrategyState({ dataDir, autoInit: false });
    st.pending_evaluation.applied_at = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
    st.last_adjustment_at = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
    await fs.writeFile(path.join(dataDir, 'strategy_state.json'), JSON.stringify(st, null, 2) + '\n');

    const earn = JSON.parse(await fs.readFile(path.join(dataDir, 'earnings_analytics.json'), 'utf8'));
    earn.analytics[sid].trend.reward_last_24h = 0; // worse
    await fs.writeFile(path.join(dataDir, 'earnings_analytics.json'), JSON.stringify(earn, null, 2) + '\n');

    const out2 = evaluateAndEvolveStrategy({ sid, dataDir, nowMs: Date.now() });
    assert.equal(out2.action, 'rollback');

    await new Promise((r) => setTimeout(r, 20));

    ev = await readLearningLedger({ dataDir });
    const evalEv = ev.find((e) => e.event_type === 'imitation_evaluation');
    assert.ok(evalEv);
    assert.equal(evalEv.decision, 'rolled_back');
    assert.equal(evalEv.result, 'degraded');

    const insights = await rebuildLearningInsights({ dataDir });
    assert.equal(insights.ok, true);
    assert.ok(insights.per_sid[sid]);
    assert.ok(insights.global.total_references >= 1);
  });
});
