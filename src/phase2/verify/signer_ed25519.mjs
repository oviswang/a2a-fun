// PHASE 2 FROZEN
// Behavior must remain stable unless fixing a critical bug.

import { sign as nodeSign, createPrivateKey } from 'node:crypto';
import { canonicalizeForSignature } from '../envelope/envelope.canonical.mjs';

/**
 * Phase 2 minimal real signer: Ed25519.
 *
 * Signature input (fixed):
 * - JCS(envelope_without_sig)
 * - UTF-8 bytes
 * Algorithm:
 * - Ed25519 (Node crypto)
 * Output:
 * - base64 signature string
 */
export function signEnvelopeEd25519(envelopeWithoutSig, privateKeyPem) {
  if (!privateKeyPem) throw new Error('Signer: missing privateKeyPem');
  const key = createPrivateKey(privateKeyPem);
  const data = canonicalizeForSignature(envelopeWithoutSig);
  const sig = nodeSign(null, data, key);
  return sig.toString('base64');
}
