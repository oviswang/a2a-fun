// PHASE 2 FROZEN
// Behavior must remain stable unless fixing a critical bug.

import { validateEnvelope } from '../envelope/envelope.schema.mjs';
import { validateDecryptedBodyByType } from '../body/body.schema.mjs';

/**
 * Phase 2 protocolProcessor (orchestrator only).
 *
 * Hard constraints:
 * - Orchestration only: no strategy, no retries, no fallback, no transport logic.
 * - No friendship writes.
 * - Audit binding is 1:1 with session_apply_result.audit_events.
 *
 * Output shape (fixed):
 * {
 *   session_apply_result,
 *   audit_records: [],
 *   decrypted_body?: object  // optional, debug/test only
 * }
 */

export function createProtocolProcessor(deps) {
  const {
    keyResolver,
    verifier,
    decrypter,
    sessionManager,
    auditBinder
  } = deps;

  if (!keyResolver?.resolvePeerPublicKey) throw new Error('protocolProcessor: missing keyResolver');
  if (!verifier?.verifyEnvelopeSignature) throw new Error('protocolProcessor: missing verifier');
  if (!decrypter?.decryptCiphertext) throw new Error('protocolProcessor: missing decrypter');
  if (!sessionManager?.apply) throw new Error('protocolProcessor: missing sessionManager.apply');
  if (!sessionManager?.applyLocalEvent) throw new Error('protocolProcessor: missing sessionManager.applyLocalEvent');
  if (!auditBinder?.bindAuditEventCore) throw new Error('protocolProcessor: missing auditBinder.bindAuditEventCore');

  /**
   * @param {{ envelope: object, state: object, debug?: boolean }} input
   */
  async function processInbound(input) {
    const { envelope, state, debug = false } = input;

    // 1) envelope schema validate
    validateEnvelope(envelope);

    // 2) resolve peer public key + verify signature (fail closed)
    const peerPublicKeyPem = await keyResolver.resolvePeerPublicKey({
      peer_actor_id: envelope.from.actor_id,
      key_fpr: envelope.from.key_fpr
    });
    if (!peerPublicKeyPem) throw new Error('Verify: missing peer public key (fail closed)');
    await verifier.verifyEnvelopeSignature(envelope, peerPublicKeyPem);

    // 3) decrypt
    const decrypted_body = await decrypter.decryptCiphertext(envelope);

    // 4) body schema validate
    validateDecryptedBodyByType({ v: envelope.v, type: envelope.type, body: decrypted_body });

    // 5) session apply
    const session_apply_result = await sessionManager.apply({
      state,
      verifiedEnvelope: envelope,
      decryptedBody: decrypted_body
    });

    // 6) audit bind (1:1)
    const audit_records = session_apply_result.audit_events.map((event_core) =>
      auditBinder.bindAuditEventCore({ event_core, envelope })
    );

    const out = { session_apply_result, audit_records };
    if (debug) out.decrypted_body = decrypted_body;
    return out;
  }


  /**
   * Local event injection entry (Phase 2).
   * Orchestration only.
   *
   * @param {{ state: object, localEvent: object, debug?: boolean }} input
   */
  async function processLocalEvent(input) {
    const { state, localEvent, debug = false } = input;

    const session_apply_result = await sessionManager.applyLocalEvent({ state, localEvent });

    const audit_records = session_apply_result.audit_events.map((event_core) =>
      auditBinder.bindAuditEventCore({ event_core, envelope: { session_id: event_core.session_id } })
    );

    const out = { session_apply_result, audit_records };
    if (debug) out.local_event = localEvent;
    return out;
  }

  return { processInbound, processLocalEvent };
}
