// Friendship Trigger Layer (runtime primitive): friendship candidate
//
// Hard constraints:
// - no persistence
// - no confirmation
// - no capability/task logic
// - machine-safe output only

import { createHash } from 'node:crypto';

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function assertNonEmptyString(v, name) {
  if (typeof v !== 'string' || v.trim() === '') throw err('INVALID_INPUT', `missing ${name}`);
}

function sha256hex(s) {
  return createHash('sha256').update(String(s), 'utf8').digest('hex');
}

/**
 * Deterministic constructor for a machine-safe friendship candidate.
 *
 * Note on determinism:
 * - candidate_id and created_at are deterministic for the same inputs.
 * - created_at is intentionally not wall-clock time in this primitive.
 */
export function createFriendshipCandidate({ session_id, peer_actor_id, phase3_state } = {}) {
  assertNonEmptyString(session_id, 'session_id');
  assertNonEmptyString(peer_actor_id, 'peer_actor_id');
  assertNonEmptyString(phase3_state, 'phase3_state');

  const material = `phase3|${session_id}|${peer_actor_id}|${phase3_state}`;
  const candidate_id = `fcand:sha256:${sha256hex(material)}`;

  // Deterministic timestamp for this primitive (no wall-clock dependency).
  const created_at = new Date(0).toISOString();

  // Machine-safe, deterministic key order.
  return {
    candidate_id,
    session_id,
    peer_actor_id,
    created_at,
    phase3_state,
    local_confirmed: false,
    remote_confirmed: false
  };
}
