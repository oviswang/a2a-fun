// Conversation Runtime Layer (primitive): conversation turn (minimal)
//
// Hard constraints:
// - deterministic, machine-safe output only
// - no transcript yet
// - no networking
// - no persistence
// - no capability/task logic

import { createHash } from 'node:crypto';

export const CONVERSATION_SPEAKERS = Object.freeze({
  AGENT: 'AGENT',
  HUMAN: 'HUMAN'
});

const SPEAKER_ALLOWLIST = Object.freeze(Object.values(CONVERSATION_SPEAKERS));

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

function assertOpening(opening) {
  if (!opening || typeof opening !== 'object' || Array.isArray(opening)) throw err('INVALID_INPUT', 'opening must be object');
  assertNonEmptyString(opening.opening_id, 'opening.opening_id');
  assertNonEmptyString(opening.interaction_id, 'opening.interaction_id');
  assertNonEmptyString(opening.text, 'opening.text');
  assertNonEmptyString(opening.created_at, 'opening.created_at');
}

/**
 * Deterministic turn derived from an opening message.
 *
 * Shape:
 * {
 *   turn_id,
 *   opening_id,
 *   speaker,
 *   text,
 *   created_at
 * }
 */
export function createConversationTurn({ opening, speaker } = {}) {
  assertOpening(opening);
  assertNonEmptyString(speaker, 'speaker');
  if (!SPEAKER_ALLOWLIST.includes(speaker)) throw err('INVALID_SPEAKER', 'speaker not allowlisted');

  const text =
    speaker === CONVERSATION_SPEAKERS.AGENT
      ? 'Hello, I can start with a lightweight introduction.'
      : 'Hi, I’m interested in learning more.';

  if (text.length > 200) throw err('INTERNAL', 'turn text too long');

  const turn_id = `turn:sha256:${sha256hex(`turn|${opening.opening_id}|${speaker}|${text}`)}`;
  const created_at = new Date(0).toISOString();

  // Machine-safe, deterministic key order.
  return {
    turn_id,
    opening_id: opening.opening_id,
    speaker,
    text,
    created_at
  };
}
