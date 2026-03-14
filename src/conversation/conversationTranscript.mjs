// Conversation Runtime Layer (primitive): conversation transcript (minimal)
//
// Hard constraints:
// - deterministic, machine-safe output only
// - bounded turns (no broad chat runtime)
// - no networking
// - no persistence
// - no capability/task logic

import { createHash } from 'node:crypto';

const MAX_TURNS = 4;

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

function assertTurn(turn, idx) {
  if (!turn || typeof turn !== 'object' || Array.isArray(turn)) throw err('INVALID_INPUT', `turns[${idx}] must be object`);
  assertNonEmptyString(turn.turn_id, `turns[${idx}].turn_id`);
  assertNonEmptyString(turn.opening_id, `turns[${idx}].opening_id`);
  assertNonEmptyString(turn.speaker, `turns[${idx}].speaker`);
  assertNonEmptyString(turn.text, `turns[${idx}].text`);
  assertNonEmptyString(turn.created_at, `turns[${idx}].created_at`);
}

/**
 * Deterministic transcript from an opening + ordered turns.
 *
 * Shape:
 * {
 *   transcript_id,
 *   opening_id,
 *   turns,
 *   created_at
 * }
 */
export function createConversationTranscript({ opening, turns } = {}) {
  assertOpening(opening);

  if (!Array.isArray(turns)) throw err('INVALID_INPUT', 'turns must be array');
  if (turns.length > MAX_TURNS) throw err('TOO_MANY_TURNS', 'turns exceeds limit');

  const copiedTurns = turns.map((t, i) => {
    assertTurn(t, i);
    if (t.opening_id !== opening.opening_id) throw err('MISMATCH', 'turn.opening_id mismatch');

    // Copy into machine-safe stable key order; do not alter text.
    return {
      turn_id: t.turn_id,
      opening_id: t.opening_id,
      speaker: t.speaker,
      text: t.text,
      created_at: t.created_at
    };
  });

  const material = `transcript|${opening.opening_id}|${copiedTurns.map((t) => t.turn_id).join(',')}`;
  const transcript_id = `trans:sha256:${sha256hex(material)}`;
  const created_at = new Date(0).toISOString();

  return {
    transcript_id,
    opening_id: opening.opening_id,
    turns: copiedTurns,
    created_at
  };
}
