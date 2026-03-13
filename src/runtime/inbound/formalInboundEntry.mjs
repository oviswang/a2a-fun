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

function fail(code) {
  return { ok: false, error: { code } };
}

export function formalInboundEntry(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fail('INVALID_PAYLOAD');
  if (!('envelope' in payload)) return fail('MISSING_ENVELOPE');

  const env = payload.envelope;
  if (!env || typeof env !== 'object' || Array.isArray(env)) return fail('INVALID_ENVELOPE');

  // Minimal candidate checks (machine-safe): required string identifiers.
  // Full schema validation remains in Phase 2 frozen modules.
  const requiredStringFields = ['session_id', 'msg_id', 'ts', 'type', 'sig', 'ciphertext'];
  for (const k of requiredStringFields) {
    if (typeof env[k] !== 'string' || !env[k].trim()) return fail('INVALID_ENVELOPE');
  }

  // Deterministic output shape.
  return { ok: true, error: null };
}
