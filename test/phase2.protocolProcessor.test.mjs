import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { createProtocolProcessor } from '../src/phase2/processor/protocolProcessor.mjs';
import { signEnvelopeEd25519 } from '../src/phase2/verify/signer_ed25519.mjs';
import { verifyEnvelopeSignatureEd25519 } from '../src/phase2/verify/verifier_ed25519.mjs';
import { applySessionMessage, applyLocalEvent } from '../src/phase2/session/session.manager.mjs';
import { CLOSE_REASONS_PHASE2 } from '../src/phase2/config/phase2.constants.mjs';
import { bindAuditEventCore } from '../src/phase2/audit/audit.binding.mjs';

function makeEnvelopeWithoutSig() {
  return {
    v: '0.4.3',
    type: 'probe.hello',
    msg_id: 'm1',
    session_id: 's1',
    ts: '2026-03-13T00:00:00Z',
    from: { actor_id: 'h:sha256:peer', key_fpr: 'k1' },
    to: { actor_id: 'h:sha256:local', key_fpr: 'k2' },
    crypto: { enc: 'aead', kdf: 'x', nonce: 'AA==' },
    body: { ciphertext: Buffer.from('cipher', 'utf8').toString('base64'), content_type: 'application/json' }
  };
}

function makeSignedEnvelope(type, privateKeyPem) {
  const base = makeEnvelopeWithoutSig();
  const envNoSig = { ...base, type };
  const sig = signEnvelopeEd25519(envNoSig, privateKeyPem);
  return { ...envNoSig, sig };
}

test('protocolProcessor happy path: DISCONNECTED + signed probe.hello -> PROBING', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });

  const envelope = makeSignedEnvelope('probe.hello', privateKeyPem);

  const state = {
    session_id: 's1',
    peer_actor_id: 'h:sha256:peer',
    state: 'DISCONNECTED',
    local_entered: false,
    remote_entered: false,
    probe_rounds_used: 0,
    probe_transcript_hash: null,
    closed_reason: null
  };

  const processor = createProtocolProcessor({
    keyResolver: {
      async resolvePeerPublicKey() { return publicKeyPem; }
    },
    verifier: {
      async verifyEnvelopeSignature(env, pem) { return verifyEnvelopeSignatureEd25519(env, pem); }
    },
    decrypter: {
      async decryptCiphertext() {
        return { protocols: ['a2a.friendship/1'] };
      }
    },
    sessionManager: {
      async apply(ctx) { return applySessionMessage(ctx); },
      async applyLocalEvent() { throw new Error('not used'); }
    },
    auditBinder: {
      bindAuditEventCore
    }
  });

  const out = await processor.processInbound({ envelope, state, debug: true });

  assert.equal(out.session_apply_result.next_state.state, 'PROBING');
  assert.equal(out.audit_records.length, out.session_apply_result.audit_events.length);
  assert.ok(out.decrypted_body);
});

test('protocolProcessor fail-closed: verify failure short-circuits and produces no audit_records', async () => {
  const calls = [];
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });

  const envelope = makeSignedEnvelope('probe.hello', privateKeyPem);
  const tampered = { ...envelope, msg_id: 'm2' }; // will break signature

  const processor = createProtocolProcessor({
    keyResolver: { async resolvePeerPublicKey() { calls.push('resolveKey'); return publicKeyPem; } },
    verifier: { async verifyEnvelopeSignature(env, pem) { calls.push('verify'); return verifyEnvelopeSignatureEd25519(env, pem); } },
    decrypter: { async decryptCiphertext() { calls.push('decrypt'); return {}; } },
    sessionManager: { async apply() { calls.push('apply'); return {}; }, async applyLocalEvent() { throw new Error('not used'); } },
    auditBinder: { bindAuditEventCore() { calls.push('audit'); return {}; } }
  });

  await assert.rejects(
    () => processor.processInbound({ envelope: tampered, state: { session_id: 's1', peer_actor_id: 'h:sha256:peer', state: 'DISCONNECTED', local_entered: false, remote_entered: false } }),
    /bad signature/
  );

  assert.deepEqual(calls, ['resolveKey', 'verify']);
});

test('protocolProcessor fail-closed: bodyValidate failure short-circuits and produces no audit_records', async () => {
  const calls = [];
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });

  const envelope = makeSignedEnvelope('human.entry', privateKeyPem);

  const processor = createProtocolProcessor({
    keyResolver: { async resolvePeerPublicKey() { calls.push('resolveKey'); return publicKeyPem; } },
    verifier: { async verifyEnvelopeSignature(env, pem) { calls.push('verify'); return verifyEnvelopeSignatureEd25519(env, pem); } },
    decrypter: { async decryptCiphertext() { calls.push('decrypt'); return { entered: true }; } }, // invalid human.entry body
    sessionManager: { async apply() { calls.push('apply'); return {}; }, async applyLocalEvent() { throw new Error('not used'); } },
    auditBinder: { bindAuditEventCore() { calls.push('audit'); return {}; } }
  });

  await assert.rejects(
    () => processor.processInbound({ envelope, state: { session_id: 's1', peer_actor_id: 'h:sha256:peer', state: 'PROBE_COMPLETE', local_entered: false, remote_entered: false } }),
    /BodySchema/
  );

  assert.deepEqual(calls, ['resolveKey', 'verify', 'decrypt']);
});

test('protocolProcessor fail-closed: session illegal transition short-circuits and produces no audit_records', async () => {
  const calls = [];
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });

  const envelope = makeSignedEnvelope('probe.hello', privateKeyPem);

  const processor = createProtocolProcessor({
    keyResolver: { async resolvePeerPublicKey() { calls.push('resolveKey'); return publicKeyPem; } },
    verifier: { async verifyEnvelopeSignature(env, pem) { calls.push('verify'); return verifyEnvelopeSignatureEd25519(env, pem); } },
    decrypter: { async decryptCiphertext() { calls.push('decrypt'); return { protocols: ['a2a.friendship/1'] }; } },
    sessionManager: { async apply(ctx) { calls.push('apply'); return applySessionMessage(ctx); }, async applyLocalEvent() { throw new Error('not used'); } },
    auditBinder: { bindAuditEventCore() { calls.push('audit'); return {}; } }
  });

  // Illegal: PROBING state receiving probe.hello
  await assert.rejects(
    () => processor.processInbound({ envelope, state: { session_id: 's1', peer_actor_id: 'h:sha256:peer', state: 'PROBING', local_entered: false, remote_entered: false } }),
    /illegal transition/
  );

  assert.deepEqual(calls, ['resolveKey', 'verify', 'decrypt', 'apply']);
});

test('protocolProcessor fail-closed: decrypt failure short-circuits and produces no audit_records', async () => {
  const calls = [];
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });

  const envelope = makeSignedEnvelope('probe.hello', privateKeyPem);

  const processor = createProtocolProcessor({
    keyResolver: { async resolvePeerPublicKey() { calls.push('resolveKey'); return publicKeyPem; } },
    verifier: { async verifyEnvelopeSignature(env, pem) { calls.push('verify'); return verifyEnvelopeSignatureEd25519(env, pem); } },
    decrypter: { async decryptCiphertext() { calls.push('decrypt'); throw new Error('DECRYPT_FAIL'); } },
    sessionManager: { async apply() { calls.push('apply'); return {}; }, async applyLocalEvent() { throw new Error('not used'); } },
    auditBinder: { bindAuditEventCore() { calls.push('audit'); return {}; } }
  });

  await assert.rejects(
    () => processor.processInbound({ envelope, state: { session_id: 's1', peer_actor_id: 'h:sha256:peer', state: 'DISCONNECTED', local_entered: false, remote_entered: false } }),
    /DECRYPT_FAIL/
  );

  // Must stop at resolveKey -> verify -> decrypt
  assert.deepEqual(calls, ['resolveKey', 'verify', 'decrypt']);
});

test('protocolProcessor.processLocalEvent happy path: local.human.entry', async () => {
  const calls = [];
  const processor = createProtocolProcessor({
    keyResolver: { async resolvePeerPublicKey() { throw new Error('not used'); } },
    verifier: { async verifyEnvelopeSignature() { throw new Error('not used'); } },
    decrypter: { async decryptCiphertext() { throw new Error('not used'); } },
    sessionManager: {
      async apply() { throw new Error('not used'); },
      async applyLocalEvent(ctx) { calls.push('applyLocalEvent'); return applyLocalEvent(ctx); }
    },
    auditBinder: { bindAuditEventCore(evt) { calls.push('audit'); return bindAuditEventCore(evt); } }
  });

  const state = { session_id: 's1', peer_actor_id: 'h:sha256:peer', state: 'PROBE_COMPLETE', local_entered: false, remote_entered: false };
  const localEvent = { type: 'local.human.entry', event_id: 'le1', probe_transcript_hash: 'h' };

  const out = await processor.processLocalEvent({ state, localEvent, debug: true });
  assert.equal(out.session_apply_result.next_state.state, 'AWAIT_ENTRY');
  assert.equal(out.audit_records.length, 1);
  assert.deepEqual(calls, ['applyLocalEvent', 'audit']);
  assert.ok(out.local_event);
});

test('protocolProcessor.processLocalEvent happy path: local.session.close', async () => {
  const calls = [];
  const processor = createProtocolProcessor({
    keyResolver: { async resolvePeerPublicKey() { throw new Error('not used'); } },
    verifier: { async verifyEnvelopeSignature() { throw new Error('not used'); } },
    decrypter: { async decryptCiphertext() { throw new Error('not used'); } },
    sessionManager: {
      async apply() { throw new Error('not used'); },
      async applyLocalEvent(ctx) { calls.push('applyLocalEvent'); return applyLocalEvent(ctx); }
    },
    auditBinder: { bindAuditEventCore(evt) { calls.push('audit'); return bindAuditEventCore(evt); } }
  });

  const state = { session_id: 's1', peer_actor_id: 'h:sha256:peer', state: 'PROBING', local_entered: false, remote_entered: false };
  const localEvent = { type: 'local.session.close', event_id: 'le2', reason: CLOSE_REASONS_PHASE2[0] };

  const out = await processor.processLocalEvent({ state, localEvent });
  assert.equal(out.session_apply_result.next_state.state, 'CLOSED');
  assert.equal(out.audit_records.length, 1);
  assert.deepEqual(calls, ['applyLocalEvent', 'audit']);
});

test('protocolProcessor.processLocalEvent fail closed: illegal local event type', async () => {
  const calls = [];
  const processor = createProtocolProcessor({
    keyResolver: { async resolvePeerPublicKey() { throw new Error('not used'); } },
    verifier: { async verifyEnvelopeSignature() { throw new Error('not used'); } },
    decrypter: { async decryptCiphertext() { throw new Error('not used'); } },
    sessionManager: {
      async apply() { throw new Error('not used'); },
      async applyLocalEvent(ctx) { calls.push('applyLocalEvent'); return applyLocalEvent(ctx); }
    },
    auditBinder: { bindAuditEventCore() { calls.push('audit'); return {}; } }
  });

  const state = { session_id: 's1', peer_actor_id: 'h:sha256:peer', state: 'PROBE_COMPLETE', local_entered: false, remote_entered: false };
  const localEvent = { type: 'local.human.exit', event_id: 'bad' };

  await assert.rejects(() => processor.processLocalEvent({ state, localEvent }), /unsupported local event type/);
  assert.deepEqual(calls, ['applyLocalEvent']);
});

test('protocolProcessor.processLocalEvent fail closed: terminal state local event', async () => {
  const calls = [];
  const processor = createProtocolProcessor({
    keyResolver: { async resolvePeerPublicKey() { throw new Error('not used'); } },
    verifier: { async verifyEnvelopeSignature() { throw new Error('not used'); } },
    decrypter: { async decryptCiphertext() { throw new Error('not used'); } },
    sessionManager: {
      async apply() { throw new Error('not used'); },
      async applyLocalEvent(ctx) { calls.push('applyLocalEvent'); return applyLocalEvent(ctx); }
    },
    auditBinder: { bindAuditEventCore() { calls.push('audit'); return {}; } }
  });

  const state = { session_id: 's1', peer_actor_id: 'h:sha256:peer', state: 'CLOSED', local_entered: false, remote_entered: false };
  const localEvent = { type: 'local.session.close', event_id: 'le3', reason: CLOSE_REASONS_PHASE2[0] };

  await assert.rejects(() => processor.processLocalEvent({ state, localEvent }), /terminal/);
  assert.deepEqual(calls, ['applyLocalEvent']);
});

test('protocolProcessor.processLocalEvent fail closed: illegal close reason', async () => {
  const calls = [];
  const processor = createProtocolProcessor({
    keyResolver: { async resolvePeerPublicKey() { throw new Error('not used'); } },
    verifier: { async verifyEnvelopeSignature() { throw new Error('not used'); } },
    decrypter: { async decryptCiphertext() { throw new Error('not used'); } },
    sessionManager: {
      async apply() { throw new Error('not used'); },
      async applyLocalEvent(ctx) { calls.push('applyLocalEvent'); return applyLocalEvent(ctx); }
    },
    auditBinder: { bindAuditEventCore() { calls.push('audit'); return {}; } }
  });

  const state = { session_id: 's1', peer_actor_id: 'h:sha256:peer', state: 'PROBING', local_entered: false, remote_entered: false };
  const localEvent = { type: 'local.session.close', event_id: 'le4', reason: 'free text' };

  await assert.rejects(() => processor.processLocalEvent({ state, localEvent }), /reason invalid/);
  assert.deepEqual(calls, ['applyLocalEvent']);
});
