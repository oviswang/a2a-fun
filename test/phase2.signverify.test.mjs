import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { signEnvelopeEd25519 } from '../src/phase2/verify/signer_ed25519.mjs';
import { verifyEnvelopeSignatureEd25519 } from '../src/phase2/verify/verifier_ed25519.mjs';

function makeEnvelopeWithoutSig() {
  return {
    v: '0.4.3',
    type: 'probe.hello',
    msg_id: 'm1',
    session_id: 's1',
    ts: '2026-03-13T00:00:00Z',
    from: { actor_id: 'h:sha256:a', key_fpr: 'k1' },
    to: { actor_id: 'h:sha256:b', key_fpr: 'k2' },
    crypto: { enc: 'aead', kdf: 'x', nonce: 'AA==' },
    body: { ciphertext: Buffer.from('cipher', 'utf8').toString('base64'), content_type: 'application/json' }
  };
}

test('sign -> verify pass (Ed25519, JCS(envelope_without_sig), UTF-8)', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });

  const envNoSig = makeEnvelopeWithoutSig();
  const sig = signEnvelopeEd25519(envNoSig, privateKeyPem);
  const env = { ...envNoSig, sig };

  assert.doesNotThrow(() => verifyEnvelopeSignatureEd25519(env, publicKeyPem));
});

test('tamper any core field -> verify fail closed', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });

  const envNoSig = makeEnvelopeWithoutSig();
  const sig = signEnvelopeEd25519(envNoSig, privateKeyPem);
  const env = { ...envNoSig, sig };

  const tamperedType = { ...env, type: 'probe.done' };
  assert.throws(() => verifyEnvelopeSignatureEd25519(tamperedType, publicKeyPem), /bad signature/);

  const tamperedTs = { ...env, ts: '2026-03-13T00:00:01Z' };
  assert.throws(() => verifyEnvelopeSignatureEd25519(tamperedTs, publicKeyPem), /bad signature/);

  const tamperedCipher = { ...env, body: { ...env.body, ciphertext: Buffer.from('evil', 'utf8').toString('base64') } };
  assert.throws(() => verifyEnvelopeSignatureEd25519(tamperedCipher, publicKeyPem), /bad signature/);
});

test('tamper sig -> verify fail closed', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });

  const envNoSig = makeEnvelopeWithoutSig();
  const sig = signEnvelopeEd25519(envNoSig, privateKeyPem);
  const env = { ...envNoSig, sig };

  const badSig = sig.slice(0, -2) + 'AA';
  assert.throws(() => verifyEnvelopeSignatureEd25519({ ...env, sig: badSig }, publicKeyPem), /bad signature/);
});
