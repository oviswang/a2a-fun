import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFormalOutboundEnvelope } from '../src/phase7/egress/formalOutboundBuilder.mjs';
import { createOutboundLint } from '../src/identity/outboundLint.mjs';

function makeEncryptOK() {
  return async () => ({
    ciphertext: Buffer.from('ciphertext-bytes', 'utf8').toString('base64'),
    nonce: 'nonce123',
    content_type: 'application/json',
    enc: 'x25519-xsalsa20-poly1305',
    kdf: 'hkdf-sha256'
  });
}

function makeSignOK() {
  return async () => Buffer.from('sig-bytes', 'utf8').toString('base64');
}

function baseArgs() {
  return {
    session_id: 's1',
    msg_id: 'm1',
    ts: new Date().toISOString(),
    from_actor_id: 'h:sha256:from',
    to_actor_id: 'h:sha256:to',
    from_key_fpr: 'sha256:fromkey',
    to_key_fpr: 'sha256:tokey',
    encrypt: makeEncryptOK(),
    sign: makeSignOK()
  };
}

test('phase7 formalOutboundBuilder: build formal envelope for probe.question -> success', async () => {
  const out = await buildFormalOutboundEnvelope({
    ...baseArgs(),
    type: 'probe.question',
    body: { q: 'A safe question.' }
  });

  assert.equal(out.status, 'FORMAL_ENVELOPE_READY');
  assert.equal(out.envelope.type, 'probe.question');
  assert.ok(out.envelope.sig);
  assert.ok(out.envelope.body.ciphertext);
});

test('phase7 formalOutboundBuilder: build formal envelope for probe.done -> success', async () => {
  const out = await buildFormalOutboundEnvelope({
    ...baseArgs(),
    type: 'probe.done',
    body: { done: true }
  });

  assert.equal(out.status, 'FORMAL_ENVELOPE_READY');
  assert.equal(out.envelope.type, 'probe.done');
  assert.ok(out.envelope.sig);
  assert.ok(out.envelope.body.ciphertext);
});

test('phase7 formalOutboundBuilder: unsupported outbound type -> fail closed', async () => {
  await assert.rejects(
    () =>
      buildFormalOutboundEnvelope({
        ...baseArgs(),
        type: 'probe.answer',
        body: { a: 'A safe answer.' }
      }),
    /unsupported outbound type/
  );
});

test('phase7 formalOutboundBuilder: invalid outbound body -> fail closed', async () => {
  await assert.rejects(
    () =>
      buildFormalOutboundEnvelope({
        ...baseArgs(),
        type: 'probe.question',
        body: { q: '' }
      }),
    /probe\.question\.q required|must be non-empty string|missing\/invalid|safe/i
  );
});

test('phase7 formalOutboundBuilder: encryption failure -> fail closed', async () => {
  await assert.rejects(
    () =>
      buildFormalOutboundEnvelope({
        ...baseArgs(),
        type: 'probe.done',
        body: { done: true },
        encrypt: async () => {
          throw new Error('ENC_FAIL');
        }
      }),
    /ENC_FAIL/
  );
});

test('phase7 formalOutboundBuilder: signing failure -> fail closed', async () => {
  await assert.rejects(
    () =>
      buildFormalOutboundEnvelope({
        ...baseArgs(),
        type: 'probe.done',
        body: { done: true },
        sign: async () => {
          throw new Error('SIGN_FAIL');
        }
      }),
    /SIGN_FAIL/
  );
});

test('phase7 formalOutboundBuilder: returned envelope includes sig and ciphertext payload', async () => {
  const out = await buildFormalOutboundEnvelope({
    ...baseArgs(),
    type: 'probe.question',
    body: { q: 'A safe question.' }
  });

  assert.ok(typeof out.envelope.sig === 'string' && out.envelope.sig.length > 0);
  assert.ok(typeof out.envelope.body.ciphertext === 'string' && out.envelope.body.ciphertext.length > 0);
  assert.ok(typeof out.envelope.crypto.nonce === 'string' && out.envelope.crypto.nonce.length > 0);
});

test('phase7 formalOutboundBuilder: no raw handle leakage in returned envelope beyond allowed fields', async () => {
  const lint = createOutboundLint();
  const out = await buildFormalOutboundEnvelope({
    ...baseArgs(),
    type: 'probe.question',
    body: { q: 'A safe question.' }
  });

  // Defense-in-depth: outbound lint over the returned envelope.
  lint.assertNoRawHandle(out.envelope, '$.envelope');
  lint.assertNoRawHandle(JSON.stringify(out.envelope), '$.envelope_serialized');
});

test('phase7 formalOutboundBuilder: encrypt() missing fields -> fail closed', async () => {
  await assert.rejects(
    () =>
      buildFormalOutboundEnvelope({
        ...baseArgs(),
        type: 'probe.done',
        body: { done: true },
        encrypt: async () => ({
          // ciphertext present but nonce missing
          ciphertext: Buffer.from('x', 'utf8').toString('base64'),
          content_type: 'application/json',
          enc: 'x25519-xsalsa20-poly1305',
          kdf: 'hkdf-sha256'
        })
      }),
    /encrypt missing nonce/
  );
});

test('phase7 formalOutboundBuilder: sign() returns empty or non-string -> fail closed', async () => {
  await assert.rejects(
    () =>
      buildFormalOutboundEnvelope({
        ...baseArgs(),
        type: 'probe.done',
        body: { done: true },
        sign: async () => ''
      }),
    /sign returned invalid sig/
  );

  await assert.rejects(
    () =>
      buildFormalOutboundEnvelope({
        ...baseArgs(),
        type: 'probe.done',
        body: { done: true },
        // @ts-ignore
        sign: async () => 123
      }),
    /sign returned invalid sig/
  );
});
