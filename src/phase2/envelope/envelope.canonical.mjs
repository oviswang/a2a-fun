// PHASE 2 FROZEN
// Behavior must remain stable unless fixing a critical bug.

import { jcsStringify } from '../../identity/jcs.mjs';

/**
 * Canonicalize envelope for signature (RFC8785-style JCS).
 * Phase 2 skeleton: reuse Phase 1 jcsStringify.
 *
 * Signature input is the envelope with `sig` omitted.
 */
export function canonicalizeForSignature(envelopeWithoutSig) {
  return Buffer.from(jcsStringify(envelopeWithoutSig), 'utf8');
}

/**
 * Extract the e_core used by v0.4.3 probe_transcript_hash (no sig).
 */
export function extractEnvelopeCoreForTranscriptHash(e) {
  return {
    v: e.v,
    type: e.type,
    msg_id: e.msg_id,
    session_id: e.session_id,
    ts: e.ts,
    from: { actor_id: e.from?.actor_id, key_fpr: e.from?.key_fpr },
    to: { actor_id: e.to?.actor_id, key_fpr: e.to?.key_fpr },
    crypto: { enc: e.crypto?.enc, kdf: e.crypto?.kdf, nonce: e.crypto?.nonce },
    body: { ciphertext: e.body?.ciphertext }
  };
}
