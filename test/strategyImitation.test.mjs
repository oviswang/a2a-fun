import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { evaluateAndEvolveStrategy, loadStrategyState } from '../src/strategy/evolution.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-imit-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function readJsonl(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

test('imitation: underperforming node applies bounded imitation hint; state + timeline mark source', async () => {
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
    assert.equal(out.ok, true);
    assert.equal(out.action, 'applied');

    const st = loadStrategyState({ dataDir, autoInit: false });
    assert.equal(st.last_adjustment_source, 'imitation_hint');
    assert.ok(st.imitation_reference);
    assert.equal(st.current_params.task_weights.t1, 1.05);

    // allow async timeline write to flush
    await new Promise((r) => setTimeout(r, 15));

    const tl = await readJsonl(path.join(dataDir, 'strategy_timeline.jsonl'));
    const lastAdj = [...tl].reverse().find((e) => e.event_type === 'strategy_adjustment');
    assert.ok(lastAdj);
    assert.equal(lastAdj.adjustment.source, 'imitation_hint');
  });
});
