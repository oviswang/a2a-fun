// Friendship Trigger Layer (runtime primitive): persistence trigger (record production)
//
// Hard constraints:
// - minimal deterministic record only (no broader social graph)
// - no capability/task logic
// - no mailbox/orchestration

import { createHash } from 'node:crypto';

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

function sha256hex(s) {
  return createHash('sha256').update(String(s), 'utf8').digest('hex');
}

/**
 * Deterministically produce a machine-safe friendship record from a mutually confirmed candidate.
 *
 * This primitive:
 * - validates confirmation flags
 * - returns a minimal record object
 * - does NOT write any social graph
 */
export function triggerFriendshipPersistence({ candidate } = {}) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw err('INVALID_INPUT', 'candidate must be object');

  assertNonEmptyString(candidate.candidate_id, 'candidate_id');
  assertNonEmptyString(candidate.session_id, 'session_id');
  assertNonEmptyString(candidate.peer_actor_id, 'peer_actor_id');

  assertBoolean(candidate.local_confirmed, 'local_confirmed');
  assertBoolean(candidate.remote_confirmed, 'remote_confirmed');
  assertBoolean(candidate.mutually_confirmed, 'mutually_confirmed');

  if (candidate.local_confirmed !== true) throw err('ILLEGAL_STATE', 'local_confirmed must be true');
  if (candidate.remote_confirmed !== true) throw err('ILLEGAL_STATE', 'remote_confirmed must be true');
  if (candidate.mutually_confirmed !== true) throw err('ILLEGAL_STATE', 'mutually_confirmed must be true');

  const material = `friendship|${candidate.candidate_id}|${candidate.session_id}|${candidate.peer_actor_id}`;
  const friendship_id = `friendship:sha256:${sha256hex(material)}`;

  const established_at = new Date(0).toISOString();

  // Machine-safe, deterministic key order.
  return {
    friendship_id,
    candidate_id: candidate.candidate_id,
    session_id: candidate.session_id,
    peer_actor_id: candidate.peer_actor_id,
    established: true,
    established_at
  };
}
