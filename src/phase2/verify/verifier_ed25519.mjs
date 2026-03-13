// PHASE 2 FROZEN
// Behavior must remain stable unless fixing a critical bug.

import { verify as nodeVerify, createPublicKey } from 'node:crypto';
import { canonicalizeForSignature } from '../envelope/envelope.canonical.mjs';

/**
 * Phase 2 minimal real verifier: Ed25519.
 *
 * Fail closed: throw on any verification failure.
 */
export function verifyEnvelopeSignatureEd25519(envelope, peerPublicKeyPem) {
  if (!peerPublicKeyPem) throw new Error('Verifier: missing peerPublicKeyPem');
  if (!envelope || typeof envelope !== 'object') throw new Error('Verifier: missing envelope');
  if (typeof envelope.sig !== 'string' || envelope.sig.length === 0) throw new Error('Verifier: missing sig');

  const key = createPublicKey(peerPublicKeyPem);

  // Build envelope_without_sig.
  const { sig, ...rest } = envelope;
  const data = canonicalizeForSignature(rest);

  // Strict-ish base64 check (fail closed)
  const b64re = /^[A-Za-z0-9+/]+={0,2}$/;
  if (!b64re.test(sig) || sig.length % 4 !== 0) {
    throw new Error('Verifier: sig not base64');
  }
  const sigBuf = Buffer.from(sig, 'base64');

  const ok = nodeVerify(null, data, key, sigBuf);
  if (!ok) {
    const err = new Error('Verifier: bad signature');
    err.code = 'BAD_SIGNATURE';
    throw err;
  }
}
