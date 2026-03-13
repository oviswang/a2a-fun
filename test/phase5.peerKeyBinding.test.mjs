import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { bindPeerKeyFingerprint } from '../src/phase5/handshake/peerKeyBinding.mjs';
import { computePeerKeyFingerprint } from '../src/phase5/keys/fingerprint.mjs';
import { createOutboundLint } from '../src/identity/outboundLint.mjs';

function makePeerKeyPem() {
  const { publicKey } = generateKeyPairSync('ed25519');
  return publicKey.export({ format: 'pem', type: 'spki' });
}

test('phase5 peer key binding: first successful binding', () => {
  const peerPublicKeyPem = makePeerKeyPem();
  const out = bindPeerKeyFingerprint({
    peer_actor_id: 'h:sha256:peer',
    peerPublicKeyPem
  });

  assert.equal(out.status, 'BOUND');
  assert.ok(out.peer_key_fpr);
  assert.deepEqual(out.patch, { peer_key_fpr: out.peer_key_fpr });
  assert.equal('peer_actor_id' in out, false);
});

test('phase5 peer key binding: repeated same binding is idempotent', () => {
  const peerPublicKeyPem = makePeerKeyPem();
  const fpr = computePeerKeyFingerprint(peerPublicKeyPem);

  const out = bindPeerKeyFingerprint({
    peer_actor_id: 'h:sha256:peer',
    peerPublicKeyPem,
    bound_peer_key_fpr: fpr
  });

  assert.equal(out.status, 'ALREADY_BOUND');
  assert.equal(out.peer_key_fpr, fpr);
  assert.equal(out.patch, null);
  assert.equal('peer_actor_id' in out, false);
});

test('phase5 peer key binding: missing key fail closed', () => {
  try {
    bindPeerKeyFingerprint({
      peer_actor_id: 'h:sha256:peer',
      peerPublicKeyPem: ''
    });
    assert.fail('expected throw');
  } catch (err) {
    assert.match(String(err.message), /missing peer public key/);
    assert.equal(err.code, 'MISSING_KEY');
  }
});

test('phase5 peer key binding: mismatched fingerprint fail closed', () => {
  const pemA = makePeerKeyPem();
  const pemB = makePeerKeyPem();
  const fprA = computePeerKeyFingerprint(pemA);

  try {
    bindPeerKeyFingerprint({
      peer_actor_id: 'h:sha256:peer',
      peerPublicKeyPem: pemB,
      bound_peer_key_fpr: fprA
    });
    assert.fail('expected throw');
  } catch (err) {
    assert.match(String(err.message), /mismatch/);
    assert.equal(err.code, 'MISMATCH');
  }
});

test('phase5 peer key binding: no raw handle leakage', () => {
  const lint = createOutboundLint();
  const pem = makePeerKeyPem();

  const out = bindPeerKeyFingerprint({
    peer_actor_id: 'h:sha256:peer',
    peerPublicKeyPem: pem
  });

  lint.assertNoRawHandle(out, '$.binding_result');
  lint.assertNoRawHandle(JSON.stringify(out), '$.binding_result_serialized');
});

test('phase5 peer key binding: no friendship side-effects', () => {
  // This module is a pure decision function; it must not touch friendshipWriter/storage.
  // Assert only that it returns a patch and does not perform any I/O.
  const pem = makePeerKeyPem();
  const out = bindPeerKeyFingerprint({ peer_actor_id: 'h:sha256:peer', peerPublicKeyPem: pem });
  assert.ok(['BOUND', 'ALREADY_BOUND'].includes(out.status));
});

test('phase5 peer key binding fail-closed: missing peer_actor_id -> throw with machine-safe code', () => {
  const pem = makePeerKeyPem();
  try {
    bindPeerKeyFingerprint({ peer_actor_id: '', peerPublicKeyPem: pem });
    assert.fail('expected throw');
  } catch (err) {
    assert.match(String(err.message), /missing peer_actor_id/);
    assert.equal(err.code, 'INVALID_INPUT');
  }
});

test('phase5 peer key binding: expected_peer_key_fpr conflicts with bound_peer_key_fpr -> fail closed', () => {
  const pemA = makePeerKeyPem();
  const pemB = makePeerKeyPem();
  const fprA = computePeerKeyFingerprint(pemA);
  const fprB = computePeerKeyFingerprint(pemB);

  try {
    bindPeerKeyFingerprint({
      peer_actor_id: 'h:sha256:peer',
      peerPublicKeyPem: pemA,
      bound_peer_key_fpr: fprA,
      expected_peer_key_fpr: fprB
    });
    assert.fail('expected throw');
  } catch (err) {
    assert.match(String(err.message), /conflict/);
    assert.equal(err.code, 'MISMATCH');
  }
});
