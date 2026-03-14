import test from 'node:test';
import assert from 'node:assert/strict';

import { formalInboundEntry } from '../src/runtime/inbound/formalInboundEntry.mjs';
import { createFriendshipCandidate } from '../src/friendship/friendshipCandidate.mjs';

function makeValidEnvelope(session_id = 's1') {
  return {
    v: '0.4.3',
    type: 'human.entry',
    msg_id: 'm1',
    session_id,
    ts: '2026-03-13T00:00:00Z',
    from: { actor_id: 'h:sha256:a', key_fpr: 'k1' },
    to: { actor_id: 'h:sha256:b', key_fpr: 'k2' },
    crypto: { enc: 'aead', kdf: 'x', nonce: 'AA==' },
    body: { ciphertext: Buffer.from('{"x":1}', 'utf8').toString('base64'), content_type: 'application/json' },
    sig: 'sig'
  };
}

test('friendship candidate: created when phase3 state == PROBING', async () => {
  const protocolProcessor = {
    async processInbound() {
      return {
        session_apply_result: { next_state: { state: 'DISCONNECTED' } },
        audit_records: [],
        phase3_session_state: {
          session_id: 's1',
          peer_actor_id: 'h:sha256:peer',
          state: 'LOCAL_ENTERED',
          local_entered: true,
          remote_entered: false
        },
        phase3_session_probe_message: { kind: 'SESSION_PROBE_ACK', session_id: 's1', peer_actor_id: 'h:sha256:peer' }
      };
    }
  };

  const out = await formalInboundEntry(
    { envelope: makeValidEnvelope('s1') },
    { storage: { async readSession() { return null; } }, protocolProcessor }
  );

  assert.equal(out.ok, true);
  assert.equal(out.response.phase3.state, 'PROBING');
  assert.ok(out.response.friendship_candidate);

  const expected = createFriendshipCandidate({ session_id: 's1', peer_actor_id: 'h:sha256:peer', phase3_state: 'PROBING' });
  assert.deepEqual(out.response.friendship_candidate, expected);
});

test('friendship candidate: not created when phase3 state != PROBING', async () => {
  const protocolProcessor = {
    async processInbound() {
      return {
        session_apply_result: { next_state: { state: 'DISCONNECTED' } },
        audit_records: [],
        phase3_session_probe_message: { kind: 'SESSION_PROBE_INIT', session_id: 's1', peer_actor_id: 'h:sha256:peer' }
      };
    }
  };

  const out = await formalInboundEntry(
    { envelope: makeValidEnvelope('s1') },
    { storage: { async readSession() { return null; } }, protocolProcessor }
  );

  assert.equal(out.ok, true);
  assert.equal(out.response.phase3.state, 'LOCAL_ENTERED');
  assert.equal('friendship_candidate' in out.response, false);
});

test('friendship candidate: deterministic output shape and machine-safe structure', () => {
  const a = createFriendshipCandidate({ session_id: 's1', peer_actor_id: 'h:sha256:peer', phase3_state: 'PROBING' });
  const b = createFriendshipCandidate({ session_id: 's1', peer_actor_id: 'h:sha256:peer', phase3_state: 'PROBING' });

  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a), [
    'candidate_id',
    'session_id',
    'peer_actor_id',
    'created_at',
    'phase3_state',
    'local_confirmed',
    'remote_confirmed'
  ]);

  // Machine-safe: no free-text, only IDs/flags.
  assert.ok(a.candidate_id.startsWith('fcand:sha256:'));
  assert.equal(a.local_confirmed, false);
  assert.equal(a.remote_confirmed, false);
});
