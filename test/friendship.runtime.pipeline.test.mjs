import test from 'node:test';
import assert from 'node:assert/strict';

import { formalInboundEntry } from '../src/runtime/inbound/formalInboundEntry.mjs';

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

function makeProtocolProcessorPhase3Probing() {
  return {
    async processInbound({ envelope }) {
      // Minimal processor-shaped return, without changing processor semantics:
      // formalInboundEntry only reads these optional fields.
      return {
        session_apply_result: { next_state: { state: 'DISCONNECTED' } },
        audit_records: [],
        phase3_session_state: {
          session_id: envelope.session_id,
          peer_actor_id: envelope.from.actor_id,
          state: 'LOCAL_ENTERED',
          local_entered: true,
          remote_entered: false
        },
        phase3_session_probe_message: {
          kind: 'SESSION_PROBE_ACK',
          session_id: envelope.session_id,
          peer_actor_id: envelope.from.actor_id
        }
      };
    }
  };
}

test('runtime pipeline: Phase3 PROBING -> candidate -> local confirm -> remote confirm -> persistence record', async () => {
  const out = await formalInboundEntry(
    {
      envelope: makeValidEnvelope('sess_pipe_1'),
      friendship_confirm_local: true,
      friendship_confirm_remote: true
    },
    { protocolProcessor: makeProtocolProcessorPhase3Probing() }
  );

  assert.equal(out.ok, true);
  assert.equal(out.validated, true);
  assert.equal(out.processed, true);

  assert.ok(out.response.phase3);
  assert.equal(out.response.phase3.state, 'PROBING');

  assert.ok(out.response.friendship_candidate);
  assert.equal(out.response.friendship_candidate.phase3_state, 'PROBING');

  assert.ok(out.response.friendship_confirmation_local);
  assert.equal(out.response.friendship_confirmation_local.local_confirmed, true);

  assert.ok(out.response.friendship_confirmation_remote);
  assert.equal(out.response.friendship_confirmation_remote.mutually_confirmed, true);

  assert.ok(out.response.friendship_record);
  assert.deepEqual(Object.keys(out.response.friendship_record), [
    'friendship_id',
    'candidate_id',
    'session_id',
    'peer_actor_id',
    'established',
    'established_at'
  ]);
});

test('runtime pipeline: fail closed when remote confirmation requested without local confirmation', async () => {
  const out = await formalInboundEntry(
    {
      envelope: makeValidEnvelope('sess_pipe_fail_1'),
      friendship_confirm_local: false,
      friendship_confirm_remote: true
    },
    { protocolProcessor: makeProtocolProcessorPhase3Probing() }
  );

  assert.equal(out.ok, false);
  assert.equal(out.validated, true);
  assert.equal(out.processed, true);
  assert.ok(out.error && typeof out.error.code === 'string');

  // Must not produce a friendship record.
  assert.equal(out.response, null);
});

test('runtime pipeline: no candidate when Phase3 does not produce PROBING', async () => {
  const pp = {
    async processInbound({ envelope }) {
      return {
        session_apply_result: { next_state: { state: 'DISCONNECTED' } },
        audit_records: [],
        phase3_session_state: {
          session_id: envelope.session_id,
          peer_actor_id: envelope.from.actor_id,
          state: 'NEW',
          local_entered: false,
          remote_entered: false
        },
        phase3_session_probe_message: {
          kind: 'SESSION_PROBE_INIT',
          session_id: envelope.session_id,
          peer_actor_id: envelope.from.actor_id
        }
      };
    }
  };

  const out = await formalInboundEntry({ envelope: makeValidEnvelope('sess_pipe_2') }, { protocolProcessor: pp });
  assert.equal(out.ok, true);
  assert.ok(out.response.phase3);
  assert.equal(out.response.phase3.state, 'LOCAL_ENTERED');
  assert.ok(!('friendship_candidate' in out.response));
});
