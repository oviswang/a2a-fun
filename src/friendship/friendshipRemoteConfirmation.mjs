// Friendship Trigger Layer (runtime primitive): remote confirmation
//
// Hard constraints:
// - no networking
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
 * Deterministically confirm an already locally-confirmed friendship candidate remotely.
 *
 * Requirements:
 * - local_confirmed must already be true
 * - remote_confirmed must be false before this step
 */
export function confirmFriendshipCandidateRemotely({ candidate } = {}) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw err('INVALID_INPUT', 'candidate must be object');

  assertNonEmptyString(candidate.candidate_id, 'candidate_id');
  assertNonEmptyString(candidate.session_id, 'session_id');
  assertNonEmptyString(candidate.peer_actor_id, 'peer_actor_id');
  assertBoolean(candidate.local_confirmed, 'local_confirmed');
  assertBoolean(candidate.remote_confirmed, 'remote_confirmed');

  if (candidate.local_confirmed !== true) throw err('ILLEGAL_STATE', 'local_confirmed must be true');
  if (candidate.remote_confirmed !== false) throw err('ILLEGAL_STATE', 'remote_confirmed must be false before remote confirmation');

  const confirmed_at = new Date(0).toISOString();

  // Machine-safe, deterministic key order.
  return {
    candidate_id: candidate.candidate_id,
    session_id: candidate.session_id,
    peer_actor_id: candidate.peer_actor_id,
    local_confirmed: true,
    remote_confirmed: true,
    mutually_confirmed: true,
    confirmed_at
  };
}
