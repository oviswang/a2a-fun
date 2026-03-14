// Discovery Layer (runtime primitive): compatibility / matching baseline
//
// Hard constraints:
// - no ranking engine (no cross-peer comparison)
// - no conversation preview
// - no persistence
// - no capability/task logic
// - machine-safe output only

export const DISCOVERY_COMPATIBILITY_REASONS = Object.freeze({
  KNOWN_PEER_AVAILABLE: 'KNOWN_PEER_AVAILABLE'
});

const REASON_ALLOWLIST = Object.freeze(Object.values(DISCOVERY_COMPATIBILITY_REASONS));

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function assertNonEmptyString(v, name) {
  if (typeof v !== 'string' || v.trim() === '') throw err('INVALID_INPUT', `missing ${name}`);
}

function assertCandidateShape(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw err('INVALID_INPUT', 'candidate must be object');
  assertNonEmptyString(candidate.discovery_candidate_id, 'candidate.discovery_candidate_id');
  assertNonEmptyString(candidate.peer_actor_id, 'candidate.peer_actor_id');
  assertNonEmptyString(candidate.peer_url, 'candidate.peer_url');
  assertNonEmptyString(candidate.source, 'candidate.source');
  assertNonEmptyString(candidate.created_at, 'candidate.created_at');

  // Minimal source gate for this phase: compatibility baseline only applies to known peers.
  if (candidate.source !== 'KNOWN_PEERS') throw err('INVALID_CANDIDATE', 'unsupported candidate source');
}

/**
 * Deterministic compatibility evaluation for a discovery candidate.
 *
 * Shape:
 * {
 *   discovery_candidate_id,
 *   score,         // int 0..100
 *   reasons        // allowlisted array
 * }
 */
export function evaluateDiscoveryCompatibility({ candidate } = {}) {
  assertCandidateShape(candidate);

  // Minimal deterministic baseline:
  // - every valid discovery candidate gets score=1
  // - reason is allowlisted constant
  const score = 1;
  if (!Number.isInteger(score) || score < 0 || score > 100) throw err('INTERNAL', 'score out of bounds');

  const reasons = [DISCOVERY_COMPATIBILITY_REASONS.KNOWN_PEER_AVAILABLE];
  for (const r of reasons) {
    if (!REASON_ALLOWLIST.includes(r)) throw err('INTERNAL', 'reason not allowlisted');
  }

  // Machine-safe, deterministic key order.
  return {
    discovery_candidate_id: candidate.discovery_candidate_id,
    score,
    reasons
  };
}
