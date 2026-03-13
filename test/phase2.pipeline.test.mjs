import test from 'node:test';
import assert from 'node:assert/strict';

import { processInbound } from '../src/phase2/pipeline/processInbound.mjs';
import { validateDecryptedBodyByType } from '../src/phase2/body/body.schema.mjs';
import { signEnvelopeEd25519 } from '../src/phase2/verify/signer_ed25519.mjs';
import { verifyEnvelopeSignatureEd25519 } from '../src/phase2/verify/verifier_ed25519.mjs';
import { generateKeyPairSync } from 'node:crypto';

function makeEnvelope(type = 'human.entry') {
  return {
    v: '0.4.3',
    type,
    msg_id: 'm1',
    session_id: 's1',
    ts: '2026-03-13T00:00:00Z',
    from: { actor_id: 'h:sha256:a', key_fpr: 'k1' },
    to: { actor_id: 'h:sha256:b', key_fpr: 'k2' },
    crypto: { enc: 'aead', kdf: 'x', nonce: 'AA==' },
    body: { ciphertext: Buffer.from('{"x":1}', 'utf8').toString('base64'), content_type: 'application/json' },
    sig: ''
  };
}

function signEnvelope(envNoSig, privateKeyPem) {
  const { sig, ...rest } = envNoSig;
  const signature = signEnvelopeEd25519(rest, privateKeyPem);
  return { ...rest, sig: signature };
}

test('Phase2 pipeline ordering: validate -> verify -> decrypt -> body-validate -> session-apply -> audit', async () => {
  const calls = [];
  const deps = {
    keyResolver: {
      async resolvePeerPublicKey() { calls.push('resolveKey'); return 'PEM'; }
    },
    verifier: {
      async verifyEnvelopeSignature() { calls.push('verify'); }
    },
    decrypter: {
      async decryptCiphertext() { calls.push('decrypt'); return { entered: true, bind: { session_id: 's1', probe_transcript_hash: 'h' } }; }
    },
    bodyValidator: {
      async validateDecryptedBodyByType() { calls.push('bodyValidate'); }
    },
    sessionManager: {
      async apply() { calls.push('apply'); return { next_state: { ok: true }, session_patch: {}, audit_events: [], outbound_messages: [] }; }
    },
    auditBinder: {
      bindInbound() { calls.push('audit'); return { event_hash: 'x', preview_safe: { type: 'human.entry' } }; }
    }
  };

  const res = await processInbound({
    envelope: makeEnvelope(),
    state: { session_id: 's1' },
    ...deps
  });

  assert.ok(res.body.entered);
  assert.deepEqual(calls, ['resolveKey', 'verify', 'decrypt', 'bodyValidate', 'apply', 'audit']);
});

test('Fail closed: if verify fails, decrypt/body-validate/apply/audit must not run', async () => {
  const calls = [];
  const deps = {
    keyResolver: { async resolvePeerPublicKey() { calls.push('resolveKey'); return 'PEM'; } },
    verifier: { async verifyEnvelopeSignature() { calls.push('verify'); throw new Error('bad sig'); } },
    decrypter: { async decryptCiphertext() { calls.push('decrypt'); return {}; } },
    bodyValidator: { async validateDecryptedBodyByType() { calls.push('bodyValidate'); } },
    sessionManager: { async apply() { calls.push('apply'); return {}; } },
    auditBinder: { bindInbound() { calls.push('audit'); return {}; } }
  };

  await assert.rejects(
    () => processInbound({ envelope: makeEnvelope(), state: { session_id: 's1' }, ...deps }),
    /bad sig/
  );

  assert.deepEqual(calls, ['resolveKey', 'verify']);
});

test('Fail closed: if body schema validate fails, apply/audit must not run', async () => {
  const calls = [];
  const deps = {
    keyResolver: { async resolvePeerPublicKey() { calls.push('resolveKey'); return 'PEM'; } },
    verifier: { async verifyEnvelopeSignature() { calls.push('verify'); } },
    // return invalid body
    decrypter: { async decryptCiphertext() { calls.push('decrypt'); return { entered: false }; } },
    bodyValidator: { async validateDecryptedBodyByType() { calls.push('bodyValidate'); throw new Error('BodySchema: bad'); } },
    sessionManager: { async apply() { calls.push('apply'); return {}; } },
    auditBinder: { bindInbound() { calls.push('audit'); return {}; } }
  };

  await assert.rejects(
    () => processInbound({ envelope: makeEnvelope(), state: { session_id: 's1' }, ...deps }),
    /BodySchema/
  );

  assert.deepEqual(calls, ['resolveKey', 'verify', 'decrypt', 'bodyValidate']);
});

test('Fail closed at bodyValidate: schema-valid but unsupported protocol must block apply/audit', async () => {
  const calls = [];
  const deps = {
    keyResolver: { async resolvePeerPublicKey() { calls.push('resolveKey'); return 'PEM'; } },
    verifier: { async verifyEnvelopeSignature() { calls.push('verify'); } },
    decrypter: {
      async decryptCiphertext() {
        calls.push('decrypt');
        // schema-valid a2a protocol name, but not in SUPPORTED_PROTOCOLS_PHASE2
        return { protocols: ['a2a.discovery/1'] };
      }
    },
    bodyValidator: {
      async validateDecryptedBodyByType(ctx) {
        calls.push('bodyValidate');
        // Use the real validator to ensure failure happens at bodyValidate stage.
        return validateDecryptedBodyByType(ctx);
      }
    },
    sessionManager: { async apply() { calls.push('apply'); return {}; } },
    auditBinder: { bindInbound() { calls.push('audit'); return {}; } }
  };

  await assert.rejects(
    () => processInbound({ envelope: makeEnvelope('probe.hello'), state: { session_id: 's1' }, ...deps }),
    /unsupported in Phase 2/
  );

  assert.deepEqual(calls, ['resolveKey', 'verify', 'decrypt', 'bodyValidate']);
});

test('Real verifier integration: tamper plaintext core fields -> fail closed at verify (no decrypt/bodyValidate/apply/audit)', async () => {
  const calls = [];
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });

  const signed = signEnvelope(makeEnvelope('probe.hello'), privateKeyPem);

  const baseDeps = {
    keyResolver: { async resolvePeerPublicKey() { calls.push('resolveKey'); return publicKeyPem; } },
    verifier: { async verifyEnvelopeSignature(env, pem) { calls.push('verify'); return verifyEnvelopeSignatureEd25519(env, pem); } },
    decrypter: { async decryptCiphertext() { calls.push('decrypt'); return {}; } },
    bodyValidator: { async validateDecryptedBodyByType() { calls.push('bodyValidate'); } },
    sessionManager: { async apply() { calls.push('apply'); return {}; } },
    auditBinder: { bindInbound() { calls.push('audit'); return {}; } }
  };

  const cases = [
    { name: 'msg_id', env: { ...signed, msg_id: 'm2' } },
    { name: 'session_id', env: { ...signed, session_id: 's2' } },
    { name: 'from.actor_id', env: { ...signed, from: { ...signed.from, actor_id: 'h:sha256:zzz' } } },
    { name: 'to.actor_id', env: { ...signed, to: { ...signed.to, actor_id: 'h:sha256:yyy' } } }
  ];

  for (const c of cases) {
    calls.length = 0;
    await assert.rejects(
      () => processInbound({ envelope: c.env, state: { session_id: 's1' }, ...baseDeps }),
      /bad signature/
    );
    assert.deepEqual(calls, ['resolveKey', 'verify'], `case ${c.name}`);
  }
});

test('Real verifier integration: tamper other core fields (ciphertext/nonce/content_type/key_fpr) -> fail closed at verify', async () => {
  const calls = [];
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });

  const signed = signEnvelope(makeEnvelope('probe.hello'), privateKeyPem);

  const deps = {
    keyResolver: { async resolvePeerPublicKey() { calls.push('resolveKey'); return publicKeyPem; } },
    verifier: { async verifyEnvelopeSignature(env, pem) { calls.push('verify'); return verifyEnvelopeSignatureEd25519(env, pem); } },
    decrypter: { async decryptCiphertext() { calls.push('decrypt'); return {}; } },
    bodyValidator: { async validateDecryptedBodyByType() { calls.push('bodyValidate'); } },
    sessionManager: { async apply() { calls.push('apply'); return {}; } },
    auditBinder: { bindInbound() { calls.push('audit'); return {}; } }
  };

  const cases = [
    { name: 'body.ciphertext', env: { ...signed, body: { ...signed.body, ciphertext: Buffer.from('tamper', 'utf8').toString('base64') } } },
    { name: 'crypto.nonce', env: { ...signed, crypto: { ...signed.crypto, nonce: 'AQID' } } },
    { name: 'body.content_type', env: { ...signed, body: { ...signed.body, content_type: 'text/plain' } } },
    { name: 'from.key_fpr', env: { ...signed, from: { ...signed.from, key_fpr: 'k999' } } },
    { name: 'to.key_fpr', env: { ...signed, to: { ...signed.to, key_fpr: 'k888' } } }
  ];

  for (const c of cases) {
    calls.length = 0;
    await assert.rejects(
      () => processInbound({ envelope: c.env, state: { session_id: 's1' }, ...deps }),
      /bad signature/
    );
    assert.deepEqual(calls, ['resolveKey', 'verify'], `case ${c.name}`);
  }
});

test('Real verifier: missing sig -> fail closed (no decrypt/bodyValidate/apply/audit)', async () => {
  const calls = [];
  const { publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });

  const env = { ...makeEnvelope('probe.hello') }; // sig is empty string

  const deps = {
    keyResolver: { async resolvePeerPublicKey() { calls.push('resolveKey'); return publicKeyPem; } },
    verifier: { async verifyEnvelopeSignature(env2, pem) { calls.push('verify'); return verifyEnvelopeSignatureEd25519(env2, pem); } },
    decrypter: { async decryptCiphertext() { calls.push('decrypt'); return {}; } },
    bodyValidator: { async validateDecryptedBodyByType() { calls.push('bodyValidate'); } },
    sessionManager: { async apply() { calls.push('apply'); return {}; } },
    auditBinder: { bindInbound() { calls.push('audit'); return {}; } }
  };

  await assert.rejects(
    () => processInbound({ envelope: env, state: { session_id: 's1' }, ...deps }),
    /missing sig/
  );

  assert.deepEqual(calls, ['resolveKey', 'verify']);
});

test('Real verifier: sig invalid base64 -> fail closed (no decrypt/bodyValidate/apply/audit)', async () => {
  const calls = [];
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });

  const signed = signEnvelope(makeEnvelope('probe.hello'), privateKeyPem);
  const env = { ...signed, sig: '!!!notbase64!!!' };

  const deps = {
    keyResolver: { async resolvePeerPublicKey() { calls.push('resolveKey'); return publicKeyPem; } },
    verifier: { async verifyEnvelopeSignature(env2, pem) { calls.push('verify'); return verifyEnvelopeSignatureEd25519(env2, pem); } },
    decrypter: { async decryptCiphertext() { calls.push('decrypt'); return {}; } },
    bodyValidator: { async validateDecryptedBodyByType() { calls.push('bodyValidate'); } },
    sessionManager: { async apply() { calls.push('apply'); return {}; } },
    auditBinder: { bindInbound() { calls.push('audit'); return {}; } }
  };

  await assert.rejects(
    () => processInbound({ envelope: env, state: { session_id: 's1' }, ...deps }),
    /sig not base64/
  );

  assert.deepEqual(calls, ['resolveKey', 'verify']);
});

test('Real verifier: missing peer public key -> fail closed before verify (no decrypt/bodyValidate/apply/audit)', async () => {
  const calls = [];
  const { privateKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });

  const signed = signEnvelope(makeEnvelope('probe.hello'), privateKeyPem);

  const deps = {
    keyResolver: { async resolvePeerPublicKey() { calls.push('resolveKey'); return null; } },
    verifier: { async verifyEnvelopeSignature() { calls.push('verify'); } },
    decrypter: { async decryptCiphertext() { calls.push('decrypt'); return {}; } },
    bodyValidator: { async validateDecryptedBodyByType() { calls.push('bodyValidate'); } },
    sessionManager: { async apply() { calls.push('apply'); return {}; } },
    auditBinder: { bindInbound() { calls.push('audit'); return {}; } }
  };

  await assert.rejects(
    () => processInbound({ envelope: signed, state: { session_id: 's1' }, ...deps }),
    /missing peer public key/
  );

  assert.deepEqual(calls, ['resolveKey']);
});
