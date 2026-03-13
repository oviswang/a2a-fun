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

function fail(code) {
  return { ok: false, error: { code } };
}

export async function formalInboundEntry(payload, { storage } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fail('INVALID_PAYLOAD');
  if (!('envelope' in payload)) return fail('MISSING_ENVELOPE');

  const env = payload.envelope;
  if (!env || typeof env !== 'object' || Array.isArray(env)) return fail('INVALID_ENVELOPE');

  // Strict Phase 2 envelope validation (frozen).
  try {
    validateEnvelope(env);
  } catch {
    return fail('INVALID_ENVELOPE');
  }

  const session_id = env.session_id;
  if (typeof session_id !== 'string' || !session_id) return fail('INVALID_ENVELOPE');

  // Minimal session handoff (no protocolProcessor call in this step).
  let session_found = null;
  let state = null;

  if (storage && typeof storage.readSession === 'function') {
    const snap = await storage.readSession(session_id);
    if (snap) {
      session_found = true;
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

  // Deterministic output shape.
  return {
    ok: true,
    validated: true,
    session_id,
    session_found,
    state,
    error: null
  };
}
