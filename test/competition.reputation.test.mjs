import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { emitReputationEvent, getReputation, getRecentReputationEvents } from '../src/reputation/reputation.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-comp-rep-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('competition win/loss affects reputation lightly and is visible in breakdown', async () => {
  await withTempDir(async (dataDir) => {
    const sid = 'sid-node';

    emitReputationEvent({ super_identity_id: sid, event_type: 'competition_win', source: { type: 'system' }, context: { channel: 'pull' } }, { dataDir });
    emitReputationEvent({ super_identity_id: sid, event_type: 'competition_loss', source: { type: 'system' }, context: { channel: 'pull' } }, { dataDir });

    const r = getReputation(sid, { dataDir }).reputation;
    assert.equal(r.score, 0.8);
    assert.equal(r.breakdown.competition_win, 1);
    assert.equal(r.breakdown.competition_loss, 1);
  });
});

test('repeated losses do not collapse reputation harshly (loss weight -0.2)', async () => {
  await withTempDir(async (dataDir) => {
    const sid = 'sid-node';
    for (let i = 0; i < 20; i++) {
      emitReputationEvent({ super_identity_id: sid, event_type: 'competition_loss', source: { type: 'system' }, context: {} }, { dataDir });
    }
    const r = getReputation(sid, { dataDir }).reputation;
    assert.ok(r.score >= -5);
  });
});

test('competition event rate limiting: record event but do not affect score after 5/h', async () => {
  await withTempDir(async (dataDir) => {
    const sid = 'sid-node';

    let last;
    for (let i = 0; i < 6; i++) {
      last = emitReputationEvent({ super_identity_id: sid, event_type: 'competition_win', source: { type: 'system' }, context: {} }, { dataDir });
    }

    assert.equal(last.ok, true);
    assert.equal(last.rate_limited, true);
    assert.equal(last.applied_delta, 0);

    const r = getReputation(sid, { dataDir }).reputation;
    assert.equal(r.breakdown.competition_win, 5); // 6th did not increment breakdown (no index update)

    const recent = getRecentReputationEvents(sid, { limit: 10, dataDir }).events;
    assert.ok(recent.find((e) => e.event_type === 'competition_win' && e.context?.meta?.rate_limited === true));
  });
});
