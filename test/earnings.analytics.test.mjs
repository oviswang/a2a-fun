import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { creditReward } from '../src/reward/reward.mjs';
import { rebuildEarningsAnalytics } from '../src/analytics/earnings.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-earn-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function appendLine(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.appendFile(p, JSON.stringify(obj) + '\n', 'utf8');
}

test('earnings analytics rebuild: breakdown by task type and channel; trend computed', async () => {
  await withTempDir(async (dataDir) => {
    const sid = 'sid-earner';

    // seed offers to enable expected_value join
    const offerFeed = path.join(dataDir, 'offer_feed.jsonl');
    await appendLine(offerFeed, { ts: new Date().toISOString(), event_type: 'offer_created', offer_id: 'offer-1', task_type: 'runtime_status', expected_value: 2 });
    await appendLine(offerFeed, { ts: new Date().toISOString(), event_type: 'offer_created', offer_id: 'offer-2', task_type: 'capability_summary', expected_value: 5 });

    creditReward({ super_identity_id: sid, amount: 2, context: { offer_id: 'offer-1', task_id: 'runtime_status', source_super_identity_id: 'sid-src', metadata: { channel: 'pull' } } }, { dataDir });
    creditReward({ super_identity_id: sid, amount: 5, context: { offer_id: 'offer-2', task_id: 'capability_summary', source_super_identity_id: 'sid-src', metadata: { channel: 'whatsapp' } } }, { dataDir });

    const out = rebuildEarningsAnalytics({ dataDir }).analytics.analytics[sid];
    assert.equal(out.total_reward, 7);
    assert.equal(out.credited_events, 2);
    assert.equal(out.reward_by_task_type.runtime_status, 2);
    assert.equal(out.reward_by_task_type.capability_summary, 5);
    assert.equal(out.reward_by_channel.pull, 2);
    assert.equal(out.reward_by_channel.whatsapp, 5);
    assert.ok(out.trend.reward_last_24h >= 7);
  });
});
