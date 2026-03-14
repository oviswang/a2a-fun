// Conversation Runtime Layer (primitive): Conversation -> Friendship handoff (minimal)
//
// Hard constraints:
// - no networking
// - no persistence
// - must NOT trigger friendship persistence directly
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

function assertSurface(surface) {
  if (!surface || typeof surface !== 'object' || Array.isArray(surface)) throw err('INVALID_INPUT', 'surface must be object');
  assertNonEmptyString(surface.surface_id, 'surface.surface_id');
  assertNonEmptyString(surface.transcript_id, 'surface.transcript_id');
  if (!Array.isArray(surface.action_options)) throw err('INVALID_INPUT', 'surface.action_options must be array');
  assertNonEmptyString(surface.default_action, 'surface.default_action');
  assertNonEmptyString(surface.summary, 'surface.summary');
}

/**
 * createConversationFriendshipHandoff({ surface, action })
 *
 * Rules:
 * - only action "HANDOFF_TO_FRIENDSHIP" creates a handoff object
 * - action "SKIP" or "CONTINUE" produces no handoff (returns null)
 * - any other action fails closed
 */
export function createConversationFriendshipHandoff({ surface, action } = {}) {
  assertSurface(surface);
  assertNonEmptyString(action, 'action');

  if (action === 'SKIP' || action === 'CONTINUE') return null;
  if (action !== 'HANDOFF_TO_FRIENDSHIP') throw err('INVALID_ACTION', 'action not allowed');

  const material = `handoff|${surface.surface_id}|${action}|FRIENDSHIP_TRIGGER`;
  const handoff_id = `chand:sha256:${sha256hex(material)}`;

  return {
    handoff_id,
    surface_id: surface.surface_id,
    action,
    proceed: true,
    target: 'FRIENDSHIP_TRIGGER'
  };
}
