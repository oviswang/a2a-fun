import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { emitReputationEvent } from '../src/reputation/reputation.mjs';
import { emitValueForTaskSuccess, getValue, rebuildValueIndex } from '../src/value/value.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-value-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('task_success generates value and accumulates per super_identity separately', async () => {
  await withTempDir(async (dataDir) => {
    const sid1 = 'sid-v1';
    const sid2 = 'sid-v2';

    emitValueForTaskSuccess({ super_identity_id: sid1, context: { source_sid: 'system', task: 't' }, dataDir });
    emitValueForTaskSuccess({ super_identity_id: sid1, context: { source_sid: 'system', task: 't' }, dataDir });
    emitValueForTaskSuccess({ super_identity_id: sid2, context: { source_sid: 'system', task: 't', expected_value: 3 }, dataDir });

    const v1 = getValue(sid1, { dataDir }).value;
    const v2 = getValue(sid2, { dataDir }).value;

    assert.equal(v1.total_value, 2);
    assert.equal(v2.total_value, 3);
  });
});

test('reputation multiplier affects value slightly', async () => {
  await withTempDir(async (dataDir) => {
    const sidHigh = 'sid-high';
    const sidLow = 'sid-low';

    // high rep > 5 -> 1.2 (cap is +5 per hour per source; use peer_ack from distinct sources)
    for (let i = 0; i < 6; i++) {
      emitReputationEvent({ super_identity_id: sidHigh, event_type: 'peer_ack', source: { type: 'peer', super_identity_id: `sid-peer${i}` } }, { dataDir });
    }
    // low rep < -5 -> 0.8
    for (let i = 0; i < 3; i++) {
      emitReputationEvent({ super_identity_id: sidLow, event_type: 'peer_flag', source: { type: 'peer', super_identity_id: `sid-peerX${i}` } }, { dataDir });
    }

    emitValueForTaskSuccess({ super_identity_id: sidHigh, context: { source_sid: 'system' }, dataDir });
    emitValueForTaskSuccess({ super_identity_id: sidLow, context: { source_sid: 'system' }, dataDir });

    const vh = getValue(sidHigh, { dataDir }).value;
    const vl = getValue(sidLow, { dataDir }).value;

    assert.equal(vh.total_value, 1.2);
    assert.equal(vl.total_value, 0.8);
  });
});

test('self-reward blocked (source_sid == target_sid)', async () => {
  await withTempDir(async (dataDir) => {
    const sid = 'sid-self';
    emitValueForTaskSuccess({ super_identity_id: sid, context: { source_sid: sid }, dataDir });
    const v = getValue(sid, { dataDir }).value;
    assert.equal(v.total_value, 0);
    assert.equal(v.event_count, 1);
  });
});

test('rate limit works: per source_sid per hour max value=10', async () => {
  await withTempDir(async (dataDir) => {
    const sid = 'sid-rl';
    for (let i = 0; i < 12; i++) {
      emitValueForTaskSuccess({ super_identity_id: sid, context: { source_sid: 'system' }, dataDir });
    }
    const v = getValue(sid, { dataDir }).value;
    // 10 events applied, 2 rate-limited to 0, event_count still 12
    assert.equal(v.total_value, 10);
    assert.equal(v.event_count, 12);
  });
});

test('rebuild index matches ledger totals', async () => {
  await withTempDir(async (dataDir) => {
    const sid = 'sid-rebuild';
    emitValueForTaskSuccess({ super_identity_id: sid, context: { source_sid: 'system' }, dataDir });
    emitValueForTaskSuccess({ super_identity_id: sid, context: { source_sid: 'system' }, dataDir });

    const before = getValue(sid, { dataDir }).value.total_value;
    const rb = rebuildValueIndex({ dataDir });
    assert.equal(rb.ok, true);
    const after = getValue(sid, { dataDir }).value.total_value;
    assert.equal(after, before);
  });
});
