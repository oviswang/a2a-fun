/**
 * Phase 2 Protocol Runtime Integration — Step 1
 *
 * Single formal inbound entrypoint.
 *
 * Accepted payload shape (fixed):
 *   { envelope: <Phase2EnvelopeCandidate> }
 *
 * This step does NOT:
 * - call protocolProcessor
 * - load session state
 * - wire transport responses
 *
 * It only performs minimal machine-safe validation that the payload is a
 * candidate formal envelope object.
 */

import { validateEnvelope } from '../../phase2/envelope/envelope.schema.mjs';
import { applySessionProbeMessage } from '../../phase3/session/sessionStateTransition.mjs';

function fail({ code, validated = null, session_id = null, session_found = null, processed = null } = {}) {
  return {
    ok: false,
    validated,
    session_id,
    session_found,
    processed,
    response: null,
    error: { code }
  };
}

export async function formalInboundEntry(payload, { storage, protocolProcessor } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fail({ code: 'INVALID_PAYLOAD', validated: false });
  if (!('envelope' in payload)) return fail({ code: 'MISSING_ENVELOPE', validated: false });

  const env = payload.envelope;
  if (!env || typeof env !== 'object' || Array.isArray(env)) return fail({ code: 'INVALID_ENVELOPE', validated: false });

  // Strict Phase 2 envelope validation (frozen).
  try {
    validateEnvelope(env);
  } catch {
    return fail({ code: 'INVALID_ENVELOPE', validated: false });
  }

  const session_id = env.session_id;
  if (typeof session_id !== 'string' || !session_id) return fail({ code: 'INVALID_ENVELOPE', validated: false });

  // Minimal session handoff.
  let session_found = null;
  let state = null;
  let stateForProcessor = null;

  if (storage && typeof storage.readSession === 'function') {
    const snap = await storage.readSession(session_id);
    if (snap) {
      session_found = true;
      stateForProcessor = snap;
      // Only return a minimal safe subset.
      state = {
        session_id: snap.session_id ?? session_id,
        state: snap.state ?? null,
        peer_actor_id: snap.peer_actor_id ?? null,
        peer_key_fpr: snap.peer_key_fpr ?? null,
        local_entered: snap.local_entered ?? null,
        remote_entered: snap.remote_entered ?? null,
        closed_reason: snap.closed_reason ?? null
      };
    } else {
      session_found = false;
    }
  }

  if (!stateForProcessor) {
    // Minimal default consistent with the current runtime boundary.
    stateForProcessor = {
      session_id,
      peer_actor_id: env.from?.actor_id ?? 'h:sha256:unknown',
      state: 'DISCONNECTED',
      local_entered: false,
      remote_entered: false
    };
  }

  if (!protocolProcessor || typeof protocolProcessor.processInbound !== 'function') {
    return fail({ code: 'MISSING_PROCESSOR', validated: true, session_id, session_found });
  }

  let processed = false;
  let response = null;

  try {
    const r = await protocolProcessor.processInbound({ envelope: env, state: stateForProcessor });
    processed = true;

    response = {
      session_apply_result_state: r?.session_apply_result?.next_state?.state ?? null,
      audit_records_count: Array.isArray(r?.audit_records) ? r.audit_records.length : null
    };

    // -----------------------------
    // Phase 3 (Session / Probe Runtime) — minimal wiring hook
    // -----------------------------
    // Hard rule: do not broaden protocol scope here. This hook is opt-in: it only activates
    // when the processor returns an explicit phase3_session_probe_message.
    //
    // We do NOT modify Phase 2 envelope semantics, transport semantics, or processor wiring.
    // This layer only applies the already-defined minimal session/probe transition baseline.
    const phase3Msg = r?.phase3_session_probe_message ?? null;
    if (phase3Msg) {
      const basePhase3State =
        r?.phase3_session_state ??
        {
          session_id,
          peer_actor_id: null,
          state: 'NEW',
          local_entered: false,
          remote_entered: false
        };

      let next;
      try {
        next = applySessionProbeMessage({ state: basePhase3State, message: phase3Msg });
      } catch (e) {
        // Fail closed: do not proceed with any further runtime behavior.
        return fail({ code: e?.code || 'PHASE3_FAIL', validated: true, session_id, session_found, processed: true });
      }

      // Machine-safe subset surface for Phase 3 only.
      response.phase3 = {
        session_id: next.session_id,
        state: next.state,
        local_entered: next.local_entered,
        remote_entered: next.remote_entered
      };
    }
  } catch {
    return fail({ code: 'PROCESSOR_FAIL', validated: true, session_id, session_found, processed: false });
  }

  // Deterministic output shape.
  return {
    ok: true,
    validated: true,
    session_id,
    session_found,
    processed,
    response,
    error: null
  };
}
