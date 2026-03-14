// Conversation Runtime Layer (primitive): human-observable conversation surface (minimal)
//
// Hard constraints:
// - no real UI
// - no networking
// - no persistence
// - no direct friendship trigger
// - machine-safe output only

import { createHash } from 'node:crypto';

export const CONVERSATION_SURFACE_ACTIONS = Object.freeze({
  CONTINUE: 'CONTINUE',
  SKIP: 'SKIP',
  HANDOFF_TO_FRIENDSHIP: 'HANDOFF_TO_FRIENDSHIP'
});

const ACTION_ALLOWLIST = Object.freeze(Object.values(CONVERSATION_SURFACE_ACTIONS));

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

function assertTranscript(transcript) {
  if (!transcript || typeof transcript !== 'object' || Array.isArray(transcript)) throw err('INVALID_INPUT', 'transcript must be object');
  assertNonEmptyString(transcript.transcript_id, 'transcript.transcript_id');
  assertNonEmptyString(transcript.opening_id, 'transcript.opening_id');
  if (!Array.isArray(transcript.turns)) throw err('INVALID_INPUT', 'transcript.turns must be array');
  assertNonEmptyString(transcript.created_at, 'transcript.created_at');
}

/**
 * Deterministic, machine-safe conversation surface derived from a transcript.
 *
 * Shape:
 * {
 *   surface_id,
 *   transcript_id,
 *   summary,
 *   action_options,
 *   default_action
 * }
 */
export function createConversationSurface({ transcript } = {}) {
  assertTranscript(transcript);

  const summary = 'A lightweight introduction is ready for review.';
  if (summary.length > 200) throw err('INTERNAL', 'summary too long');

  const action_options = [
    CONVERSATION_SURFACE_ACTIONS.CONTINUE,
    CONVERSATION_SURFACE_ACTIONS.SKIP,
    CONVERSATION_SURFACE_ACTIONS.HANDOFF_TO_FRIENDSHIP
  ];

  for (const a of action_options) {
    if (!ACTION_ALLOWLIST.includes(a)) throw err('INTERNAL', 'action not allowlisted');
  }

  const default_action = CONVERSATION_SURFACE_ACTIONS.SKIP;
  if (!ACTION_ALLOWLIST.includes(default_action)) throw err('INTERNAL', 'default action not allowlisted');

  const material = `surface|${transcript.transcript_id}|${action_options.join(',')}|${default_action}`;
  const surface_id = `surf:sha256:${sha256hex(material)}`;

  return {
    surface_id,
    transcript_id: transcript.transcript_id,
    summary,
    action_options,
    default_action
  };
}
