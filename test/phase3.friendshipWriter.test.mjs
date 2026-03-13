import test from 'node:test';
import assert from 'node:assert/strict';

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
      // Machine-safe: no free-text, no raw handles. We keep preview metadata only.
      return {
        event_type: 'FRIENDSHIP_EVENT',
        event_core,
        preview_safe: {
          kind: event_core.kind,
          action: event_core.action,
          peer_actor_id: event_core.peer_actor_id,
          session_id: event_core.session_id
        }
      };
    }
  };
}

test('phase3 friendshipWriter: first friendship write succeeds', async () => {
  const storage = makeInMemoryStorage();
  const auditBinder = makeAuditBinder();

  const out = await writeFriendshipIfNeeded({
    sessionState: { state: 'MUTUAL_ENTRY_CONFIRMED' },
    peer_actor_id: 'h:sha256:peer',
    peer_key_fpr: 'sha256:key',
    session_id: 's1',
    storage,
    auditBinder
  });

  assert.equal(out.status, 'WROTE');
  assert.equal(out.did_write, true);
  assert.ok(out.record);
  assert.equal(storage._get().length, 1);
  assert.equal(storage._get()[0].peer_actor_id, 'h:sha256:peer');
  assert.ok(out.audit_record);
  assert.equal(out.audit_record.preview_safe.peer_actor_id, 'h:sha256:peer');
});

test('phase3 friendshipWriter: repeated write is idempotent', async () => {
  const storage = makeInMemoryStorage({
    initial: [
      {
        peer_actor_id: 'h:sha256:peer',
        peer_key_fpr: 'sha256:key',
        session_id: 's1',
        established_at: '2026-03-13T00:00:00Z'
      }
    ]
  });
  const auditBinder = makeAuditBinder();

  const out = await writeFriendshipIfNeeded({
    sessionState: { state: 'MUTUAL_ENTRY_CONFIRMED' },
    peer_actor_id: 'h:sha256:peer',
    peer_key_fpr: 'sha256:key2',
    session_id: 's2',
    storage,
    auditBinder
  });

  assert.equal(out.status, 'IDEMPOTENT_SKIP');
  assert.equal(out.did_write, false);
  assert.equal(storage._get().length, 1);
});

test('phase3 friendshipWriter: wrong state does not write', async () => {
  const storage = makeInMemoryStorage();
  const auditBinder = makeAuditBinder();

  const out = await writeFriendshipIfNeeded({
    sessionState: { state: 'AWAIT_ENTRY' },
    peer_actor_id: 'h:sha256:peer',
    peer_key_fpr: 'sha256:key',
    session_id: 's1',
    storage,
    auditBinder
  });

  assert.equal(out.status, 'STATE_MISMATCH');
  assert.equal(out.did_write, false);
  assert.equal(storage._get().length, 0);
});

test('phase3 friendshipWriter: storage failure throws', async () => {
  const storage = makeInMemoryStorage({ failWrite: true });
  const auditBinder = makeAuditBinder();

  await assert.rejects(
    () =>
      writeFriendshipIfNeeded({
        sessionState: { state: 'MUTUAL_ENTRY_CONFIRMED' },
        peer_actor_id: 'h:sha256:peer',
        peer_key_fpr: 'sha256:key',
        session_id: 's1',
        storage,
        auditBinder
      }),
    /WRITE_FAIL/
  );
});

test('phase3 friendshipWriter: no raw handle leakage in audit', async () => {
  const storage = makeInMemoryStorage();
  const auditBinder = makeAuditBinder();

  const out = await writeFriendshipIfNeeded({
    sessionState: { state: 'MUTUAL_ENTRY_CONFIRMED' },
    peer_actor_id: 'h:sha256:peer',
    peer_key_fpr: null,
    session_id: 's1',
    storage,
    auditBinder
  });

  const lint = createOutboundLint();

  // Stronger guarantee: reuse the same outbound no-raw-handle lint.
  lint.assertNoRawHandle(out.audit_record, '$.audit_record');
  lint.assertNoRawHandle(JSON.stringify(out.audit_record), '$.audit_record_serialized');
});

test('phase3 friendshipWriter fail-closed: missing peer_actor_id throws', async () => {
  const storage = makeInMemoryStorage();
  const auditBinder = makeAuditBinder();

  await assert.rejects(
    () =>
      writeFriendshipIfNeeded({
        sessionState: { state: 'MUTUAL_ENTRY_CONFIRMED' },
        peer_actor_id: '',
        peer_key_fpr: 'sha256:key',
        session_id: 's1',
        storage,
        auditBinder
      }),
    /missing peer_actor_id/
  );
});

test('phase3 friendshipWriter fail-closed: missing session_id throws', async () => {
  const storage = makeInMemoryStorage();
  const auditBinder = makeAuditBinder();

  await assert.rejects(
    () =>
      writeFriendshipIfNeeded({
        sessionState: { state: 'MUTUAL_ENTRY_CONFIRMED' },
        peer_actor_id: 'h:sha256:peer',
        peer_key_fpr: 'sha256:key',
        session_id: '',
        storage,
        auditBinder
      }),
    /missing session_id/
  );
});
