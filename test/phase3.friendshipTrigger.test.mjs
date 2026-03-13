import test from 'node:test';
import assert from 'node:assert/strict';

import { triggerFriendshipWriteIfNeeded } from '../src/phase3/friendship/friendshipTrigger.mjs';
import { writeFriendshipIfNeeded } from '../src/phase3/friendship/friendshipWriter.mjs';
import { createOutboundLint } from '../src/identity/outboundLint.mjs';

function makeInMemoryStorage({ initial = [], failWrite = false } = {}) {
  let friends = structuredClone(initial);
  return {
    async readFriends() {
      return structuredClone(friends);
    },
    async writeFriends(next) {
      if (failWrite) throw new Error('WRITE_FAIL');
      friends = structuredClone(next);
    },
    _get() {
      return friends;
    }
  };
}

function makeAuditBinder() {
  return {
    bindFriendshipEventCore({ event_core }) {
      return {
        event_type: 'FRIENDSHIP_EVENT',
        event_core,
        preview_safe: {
          kind: event_core.kind,
          action: event_core.action,
          session_id: event_core.session_id
        }
      };
    }
  };
}

test('phase3 friendshipTrigger: state not equal to MUTUAL_ENTRY_CONFIRMED -> no trigger', async () => {
  const calls = [];
  const friendshipWriter = {
    async writeFriendshipIfNeeded() {
      calls.push('called');
      return { status: 'WROTE' };
    }
  };

  const out = await triggerFriendshipWriteIfNeeded({
    session_apply_result: { next_state: { state: 'AWAIT_ENTRY' } },
    peer_actor_id: 'h:sha256:peer',
    peer_key_fpr: 'sha256:key',
    session_id: 's1',
    storage: makeInMemoryStorage(),
    auditBinder: makeAuditBinder(),
    friendshipWriter
  });

  assert.deepEqual(calls, []);
  assert.equal(out.status, 'NO_TRIGGER');
  assert.deepEqual(out.next_state, { state: 'AWAIT_ENTRY' });
  assert.equal(out.friendship, null);
});

test('phase3 friendshipTrigger: MUTUAL_ENTRY_CONFIRMED -> friendshipWriter called', async () => {
  const calls = [];
  const friendshipWriter = {
    async writeFriendshipIfNeeded() {
      calls.push('called');
      return { status: 'WROTE' };
    }
  };

  const out = await triggerFriendshipWriteIfNeeded({
    session_apply_result: { next_state: { state: 'MUTUAL_ENTRY_CONFIRMED' } },
    peer_actor_id: 'h:sha256:peer',
    peer_key_fpr: 'sha256:key',
    session_id: 's1',
    storage: makeInMemoryStorage(),
    auditBinder: makeAuditBinder(),
    friendshipWriter
  });

  assert.deepEqual(calls, ['called']);
  assert.equal(out.status, 'TRIGGERED_WRITE');
  assert.deepEqual(out.next_state, { state: 'MUTUAL_ENTRY_CONFIRMED' });
  assert.deepEqual(out.friendship, { status: 'WROTE', did_write: true });
});

test('phase3 friendshipTrigger: repeated trigger remains idempotent through friendshipWriter result', async () => {
  const storage = makeInMemoryStorage();
  const auditBinder = makeAuditBinder();
  const friendshipWriter = { writeFriendshipIfNeeded };

  const session_apply_result = { next_state: { state: 'MUTUAL_ENTRY_CONFIRMED' } };

  const out1 = await triggerFriendshipWriteIfNeeded({
    session_apply_result,
    peer_actor_id: 'h:sha256:peer',
    peer_key_fpr: 'sha256:key',
    session_id: 's1',
    storage,
    auditBinder,
    friendshipWriter
  });

  const out2 = await triggerFriendshipWriteIfNeeded({
    session_apply_result,
    peer_actor_id: 'h:sha256:peer',
    peer_key_fpr: 'sha256:key',
    session_id: 's1',
    storage,
    auditBinder,
    friendshipWriter
  });

  assert.equal(out1.status, 'TRIGGERED_WRITE');
  assert.equal(out2.status, 'TRIGGERED_IDEMPOTENT');
  assert.deepEqual(out1.friendship, { status: 'WROTE', did_write: true });
  assert.deepEqual(out2.friendship, { status: 'IDEMPOTENT_SKIP', did_write: false });
  assert.equal(storage._get().length, 1);
});

test('phase3 friendshipTrigger: friendshipWriter failure propagates and remains isolated', async () => {
  const storage = makeInMemoryStorage({ failWrite: true });
  const auditBinder = makeAuditBinder();
  const friendshipWriter = { writeFriendshipIfNeeded };

  await assert.rejects(
    () =>
      triggerFriendshipWriteIfNeeded({
        session_apply_result: { next_state: { state: 'MUTUAL_ENTRY_CONFIRMED' } },
        peer_actor_id: 'h:sha256:peer',
        peer_key_fpr: 'sha256:key',
        session_id: 's1',
        storage,
        auditBinder,
        friendshipWriter
      }),
    /WRITE_FAIL/
  );
});

test('phase3 friendshipTrigger: no raw handle leakage in trigger result (no trigger-level audit)', async () => {
  const lint = createOutboundLint();

  const out = await triggerFriendshipWriteIfNeeded({
    session_apply_result: { next_state: { state: 'AWAIT_ENTRY' } },
    peer_actor_id: 'h:sha256:peer',
    peer_key_fpr: 'sha256:key',
    session_id: 's1',
    storage: makeInMemoryStorage(),
    auditBinder: makeAuditBinder(),
    friendshipWriter: { writeFriendshipIfNeeded }
  });

  // Trigger layer result must be machine-safe.
  lint.assertNoRawHandle(out, '$.trigger_result');
  lint.assertNoRawHandle(JSON.stringify(out), '$.trigger_result_serialized');

  // Explicitly no trigger-level audit yet.
  assert.equal('audit_record' in out, false);
});

test('phase3 friendshipTrigger fail-closed: missing session_apply_result throws', async () => {
  await assert.rejects(
    () =>
      triggerFriendshipWriteIfNeeded({
        session_apply_result: null,
        peer_actor_id: 'h:sha256:peer',
        peer_key_fpr: 'sha256:key',
        session_id: 's1',
        storage: makeInMemoryStorage(),
        auditBinder: makeAuditBinder(),
        friendshipWriter: { writeFriendshipIfNeeded }
      }),
    /missing session_apply_result/
  );
});

test('phase3 friendshipTrigger fail-closed: missing session_apply_result.next_state throws', async () => {
  await assert.rejects(
    () =>
      triggerFriendshipWriteIfNeeded({
        session_apply_result: {},
        peer_actor_id: 'h:sha256:peer',
        peer_key_fpr: 'sha256:key',
        session_id: 's1',
        storage: makeInMemoryStorage(),
        auditBinder: makeAuditBinder(),
        friendshipWriter: { writeFriendshipIfNeeded }
      }),
    /missing session_apply_result\.next_state/
  );
});
