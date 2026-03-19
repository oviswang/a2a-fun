import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { rebuildStrategyProfiles } from '../src/analytics/strategyCompetition.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-stratcomp-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function appendLine(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.appendFile(p, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n', 'utf8');
}

test('strategy profiles derived + classified; snapshot aggregates by strategy_type', async () => {
  await withTempDir(async (dataDir) => {
    // seed earnings analytics
    await fs.writeFile(
      path.join(dataDir, 'earnings_analytics.json'),
      JSON.stringify(
        {
          ok: true,
          updated_at: new Date().toISOString(),
          analytics: {
            'sid-a': { total_reward: 10, credited_events: 5, reward_by_task_type: { t1: 10 }, reward_by_channel: { pull: 10 } },
            'sid-b': { total_reward: 20, credited_events: 4, reward_by_task_type: { t2: 20 }, reward_by_channel: { whatsapp: 20 } }
          }
        },
        null,
        2
      ) + '\n'
    );

    const feed = path.join(dataDir, 'offer_feed.jsonl');
    // sid-a avg_threshold ~ 1.0 -> aggressive
    await appendLine(feed, { offer_id: 'o1', event_type: 'offer_decision', target_super_identity_id: 'sid-a', metadata: { current_threshold: 1.0 } });
    await appendLine(feed, { offer_id: 'o1', event_type: 'offer_interest', target_super_identity_id: 'sid-a' });
    await appendLine(feed, { offer_id: 'o1', event_type: 'offer_execution_attempt', target_super_identity_id: 'sid-a' });
    await appendLine(feed, { offer_id: 'o1', event_type: 'offer_execution_won', target_super_identity_id: 'sid-a' });

    // sid-b avg_threshold ~ 3.0 -> conservative
    await appendLine(feed, { offer_id: 'o2', event_type: 'offer_decision', target_super_identity_id: 'sid-b', metadata: { current_threshold: 3.0 } });
    await appendLine(feed, { offer_id: 'o2', event_type: 'offer_interest', target_super_identity_id: 'sid-b' });
    await appendLine(feed, { offer_id: 'o2', event_type: 'offer_execution_attempt', target_super_identity_id: 'sid-b' });
    await appendLine(feed, { offer_id: 'o2', event_type: 'offer_execution_lost', target_super_identity_id: 'sid-b' });

    const out = rebuildStrategyProfiles({ dataDir });
    assert.equal(out.ok, true);

    const profiles = out.profiles.profiles;
    const pa = profiles.find((x) => x.sid === 'sid-a');
    const pb = profiles.find((x) => x.sid === 'sid-b');

    assert.equal(pa.strategy_type, 'aggressive');
    assert.equal(pb.strategy_type, 'conservative');

    const snap = out.snapshot.by_strategy_type;
    assert.ok(snap.find((x) => x.strategy_type === 'aggressive'));
    assert.ok(snap.find((x) => x.strategy_type === 'conservative'));
  });
});
