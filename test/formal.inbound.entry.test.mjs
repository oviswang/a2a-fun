import test from 'node:test';
import assert from 'node:assert/strict';

import { formalInboundEntry } from '../src/runtime/inbound/formalInboundEntry.mjs';
import { createProtocolProcessor } from '../src/phase2/processor/protocolProcessor.mjs';

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

function makeProtocolProcessorOk() {
  return createProtocolProcessor({
    keyResolver: { async resolvePeerPublicKey() { return 'PEM'; } },
    verifier: { async verifyEnvelopeSignature() {} },
    decrypter: {
      async decryptCiphertext(envelope) {
        return { entered: true, bind: { session_id: envelope.session_id, probe_transcript_hash: 'h' } };
      }
    },
    sessionManager: {
      async apply() {
        return { next_state: { state: 'DISCONNECTED' }, session_patch: {}, audit_events: [], outbound_messages: [] };
      },
      async applyLocalEvent() {
        throw new Error('not used');
      }
    },
    auditBinder: {
      bindAuditEventCore() {
        return { event_hash: 'x', preview_safe: { type: 'human.entry' } };
      }
    }
  });
}

test('formal inbound entry: validated envelope + session handoff + processor call succeeds', async () => {
  const storage = {
    async readSession(session_id) {
      if (session_id !== 's1') return null;
      return { session_id: 's1', state: 'DISCONNECTED', local_entered: false, remote_entered: false, peer_actor_id: 'h:sha256:a' };
    }
  };

  const out = await formalInboundEntry(
    { envelope: makeValidEnvelope('s1') },
    { storage, protocolProcessor: makeProtocolProcessorOk() }
  );

  assert.deepEqual(out, {
    ok: true,
    validated: true,
    session_id: 's1',
    session_found: true,
    processed: true,
    response: { session_apply_result_state: 'DISCONNECTED', audit_records_count: 0 },
    error: null
  });
});

test('formal inbound entry: validated envelope + session not found still reaches processor safely', async () => {
  const storage = { async readSession() { return null; } };

  const out = await formalInboundEntry(
    { envelope: makeValidEnvelope('s1') },
    { storage, protocolProcessor: makeProtocolProcessorOk() }
  );

  assert.equal(out.ok, true);
  assert.equal(out.validated, true);
  assert.equal(out.session_found, false);
  assert.equal(out.processed, true);
  assert.deepEqual(out.response, { session_apply_result_state: 'DISCONNECTED', audit_records_count: 0 });
});

test('formal inbound entry: processor failure fails closed with machine-safe result', async () => {
  const pp = createProtocolProcessor({
    keyResolver: { async resolvePeerPublicKey() { return 'PEM'; } },
    verifier: { async verifyEnvelopeSignature() {} },
    decrypter: { async decryptCiphertext() { throw new Error('boom'); } },
    sessionManager: {
      async apply() { throw new Error('not reached'); },
      async applyLocalEvent() { throw new Error('not used'); }
    },
    auditBinder: { bindAuditEventCore() { return { event_hash: 'x', preview_safe: { type: 'human.entry' } }; } }
  });

  const out = await formalInboundEntry({ envelope: makeValidEnvelope('s1') }, { protocolProcessor: pp });
  assert.deepEqual(out, {
    ok: false,
    validated: true,
    session_id: 's1',
    session_found: null,
    processed: false,
    response: null,
    error: { code: 'PROCESSOR_FAIL' }
  });
});

test('formal inbound entry: missing envelope fails closed', async () => {
  const out = await formalInboundEntry({}, { protocolProcessor: makeProtocolProcessorOk() });
  assert.deepEqual(out, {
    ok: false,
    validated: false,
    session_id: null,
    session_found: null,
    processed: null,
    response: null,
    error: { code: 'MISSING_ENVELOPE' }
  });
});

test('formal inbound entry: non-object payload fails closed', async () => {
  const out = await formalInboundEntry('nope', { protocolProcessor: makeProtocolProcessorOk() });
  assert.deepEqual(out, {
    ok: false,
    validated: false,
    session_id: null,
    session_found: null,
    processed: null,
    response: null,
    error: { code: 'INVALID_PAYLOAD' }
  });
});

test('formal inbound entry: deterministic machine-safe output shape', async () => {
  const pp = makeProtocolProcessorOk();
  const a = await formalInboundEntry({ envelope: makeValidEnvelope('s1') }, { protocolProcessor: pp });
  const b = await formalInboundEntry({ envelope: makeValidEnvelope('s1') }, { protocolProcessor: pp });
  assert.deepEqual(Object.keys(a), Object.keys(b));
  assert.equal(JSON.stringify(a), JSON.stringify(b));

  // Must not expose decrypted contents or raw envelope.
  assert.ok(!('decrypted_body' in a));
  assert.ok(!('envelope' in a));
});
