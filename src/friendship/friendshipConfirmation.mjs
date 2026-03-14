// Friendship Trigger Layer (runtime primitive): local human confirmation
//
// Hard constraints:
// - no remote confirmation
// - no persistence
// - no capability/task logic
// - machine-safe output only

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function assertNonEmptyString(v, name) {
  if (typeof v !== 'string' || v.trim() === '') throw err('INVALID_INPUT', `missing ${name}`);
}

function assertBoolean(v, name) {
  if (typeof v !== 'boolean') throw err('INVALID_INPUT', `missing/invalid ${name}`);
}

/**
 * Deterministically confirm an existing friendship candidate locally.
 *
 * Notes:
 * - This primitive is deterministic for the same input.
 * - confirmed_at is intentionally not wall-clock time at this stage.
 */
export function confirmFriendshipCandidateLocally({ candidate } = {}) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw err('INVALID_INPUT', 'candidate must be object');

  assertNonEmptyString(candidate.candidate_id, 'candidate_id');
  assertNonEmptyString(candidate.session_id, 'session_id');
  assertNonEmptyString(candidate.peer_actor_id, 'peer_actor_id');
  assertBoolean(candidate.local_confirmed, 'local_confirmed');
  assertBoolean(candidate.remote_confirmed, 'remote_confirmed');

  if (candidate.remote_confirmed !== false) throw err('ILLEGAL_STATE', 'remote_confirmed must be false in this step');
  if (candidate.local_confirmed !== false) throw err('ILLEGAL_STATE', 'candidate already locally confirmed');

  const confirmed_at = new Date(0).toISOString();

  // Machine-safe, deterministic key order.
  return {
    candidate_id: candidate.candidate_id,
    session_id: candidate.session_id,
    peer_actor_id: candidate.peer_actor_id,
    local_confirmed: true,
    remote_confirmed: false,
    confirmed_at
  };
}
