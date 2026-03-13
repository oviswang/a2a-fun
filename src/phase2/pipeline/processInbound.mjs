// PHASE 2 FROZEN
// Behavior must remain stable unless fixing a critical bug.

import { validateEnvelope } from '../envelope/envelope.schema.mjs';

/**
 * Phase 2 skeleton pipeline.
 *
 * Normative ordering:
 * 1) validate envelope schema
 * 2) verify envelope signature
 * 3) decrypt ciphertext -> body
 * 4) validate decrypted body schema
 * 5) session manager apply
 * 6) audit binding
 *
 * Fail closed: any error throws; later stages must not run.
 */
export async function processInbound({
  envelope,
  state,
  keyResolver,
  verifier,
  decrypter,
  bodyValidator,
  sessionManager,
  auditBinder
}) {
  // 1) Envelope schema validate
  validateEnvelope(envelope);

  // 2) Verify envelope signature
  const peerPublicKeyPem = await keyResolver.resolvePeerPublicKey({
    peer_actor_id: envelope.from.actor_id,
    key_fpr: envelope.from.key_fpr
  });
  if (!peerPublicKeyPem) throw new Error('Verify: missing peer public key (fail closed)');
  await verifier.verifyEnvelopeSignature(envelope, peerPublicKeyPem);

  // 3) Decrypt
  const body = await decrypter.decryptCiphertext(envelope);

  // 4) Validate decrypted body schema
  if (!bodyValidator?.validateDecryptedBodyByType) throw new Error('Pipeline: missing bodyValidator');
  await bodyValidator.validateDecryptedBodyByType({ v: envelope.v, type: envelope.type, body });

  // 5) Session manager apply
  const applyResult = await sessionManager.apply({ state, verifiedEnvelope: envelope, decryptedBody: body });

  // 6) Audit binding (minimal)
  const audit = auditBinder.bindInbound({ envelope, stage: 'APPLIED' });

  return { body, applyResult, audit };
}
