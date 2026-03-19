import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { resolveSuperIdentityId, mergeIdentity, inspectIdentityState } from '../src/identity/superIdentity.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-sid-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('same channel identity resolves consistently to same super_identity_id', async () => {
  await withTempDir(async (dataDir) => {
    const r1 = resolveSuperIdentityId({ channel: 'telegram', user_id: '123', dataDir });
    const r2 = resolveSuperIdentityId({ channel: 'telegram', user_id: '123', dataDir });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r1.super_identity_id, r2.super_identity_id);
  });
});

test('no silent merge: different channels get different super_identity_id until explicitly merged', async () => {
  await withTempDir(async (dataDir) => {
    const t = resolveSuperIdentityId({ channel: 'telegram', user_id: '123', dataDir });
    const w = resolveSuperIdentityId({ channel: 'whatsapp', user_id: '+659000', dataDir });
    assert.notEqual(t.super_identity_id, w.super_identity_id);
  });
});

test('explicit merge links multiple channels into one super_identity_id and is auditable', async () => {
  await withTempDir(async (dataDir) => {
    const t = resolveSuperIdentityId({ channel: 'telegram', user_id: '123', dataDir });
    const w = resolveSuperIdentityId({ channel: 'whatsapp', user_id: '+659000', dataDir });

    const merged = mergeIdentity({
      dataDir,
      target_super_identity_id: t.super_identity_id,
      sources: [{ channel: 'whatsapp', user_id: '+659000' }]
    });
    assert.equal(merged.ok, true);
    assert.equal(merged.merged, true);

    const w2 = resolveSuperIdentityId({ channel: 'whatsapp', user_id: '+659000', dataDir });
    assert.equal(w2.super_identity_id, t.super_identity_id);

    const state = inspectIdentityState({ dataDir });
    assert.equal(state.ok, true);
    assert.ok(Array.isArray(state.merge_history.history));
    assert.ok(state.merge_history.history.length >= 1);
    assert.equal(state.merge_history.history[0].op, 'merge_identity');
  });
});
