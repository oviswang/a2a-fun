import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { emitReputationEvent, getReputation, rebuildReputationIndex } from '../src/reputation/reputation.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-rep-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('same super_identity accumulates score across channels (system events) and different sids do not merge', async () => {
  await withTempDir(async (dataDir) => {
    const sid1 = 'sid-aaa111';
    const sid2 = 'sid-bbb222';

    emitReputationEvent({ super_identity_id: sid1, event_type: 'task_success', source: { type: 'system' }, context: { channel: 'telegram', task: 'x' } }, { dataDir });
    emitReputationEvent({ super_identity_id: sid1, event_type: 'task_success', source: { type: 'system' }, context: { channel: 'whatsapp', task: 'x' } }, { dataDir });
    emitReputationEvent({ super_identity_id: sid2, event_type: 'task_failure', source: { type: 'system' }, context: { channel: 'lark', task: 'x' } }, { dataDir });

    const r1 = getReputation(sid1, { dataDir });
    const r2 = getReputation(sid2, { dataDir });

    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r1.reputation.score, 2);
    assert.equal(r2.reputation.score, -1);
  });
});

test('spam from same source is rate-limited (positive cap)', async () => {
  await withTempDir(async (dataDir) => {
    const sid = 'sid-ccc333';

    for (let i = 0; i < 5; i++) {
      const out = emitReputationEvent({ super_identity_id: sid, event_type: 'peer_ack', source: { type: 'peer', super_identity_id: 'sid-peer1' }, context: { channel: 'telegram' } }, { dataDir });
      assert.equal(out.ok, true);
    }

    const sixth = emitReputationEvent({ super_identity_id: sid, event_type: 'peer_ack', source: { type: 'peer', super_identity_id: 'sid-peer1' }, context: { channel: 'telegram' } }, { dataDir });
    assert.equal(sixth.ok, false);
    assert.equal(sixth.error.code, 'RATE_LIMITED');
  });
});

test('rebuild produces same index from ledger', async () => {
  await withTempDir(async (dataDir) => {
    const sid = 'sid-ddd444';
    emitReputationEvent({ super_identity_id: sid, event_type: 'task_success', source: { type: 'system' } }, { dataDir });
    emitReputationEvent({ super_identity_id: sid, event_type: 'peer_flag', source: { type: 'peer', super_identity_id: 'sid-peer2' } }, { dataDir });

    const before = getReputation(sid, { dataDir }).reputation.score;

    const rebuilt = rebuildReputationIndex({ dataDir });
    assert.equal(rebuilt.ok, true);

    const after = getReputation(sid, { dataDir }).reputation.score;
    assert.equal(after, before);
  });
});
