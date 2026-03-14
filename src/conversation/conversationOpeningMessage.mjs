// Conversation Runtime Layer (primitive): opening message
//
// Hard constraints:
// - deterministic, machine-safe output only
// - no turn-taking / transcript
// - no networking
// - no persistence
// - no capability/task logic

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

function assertInteraction(interaction) {
  if (!interaction || typeof interaction !== 'object' || Array.isArray(interaction)) throw err('INVALID_INPUT', 'interaction must be object');
  assertNonEmptyString(interaction.interaction_id, 'interaction.interaction_id');
}

/**
 * Deterministic opening message derived from a discovery interaction.
 *
 * Shape:
 * {
 *   opening_id,
 *   interaction_id,
 *   text,
 *   created_at
 * }
 */
export function createConversationOpeningMessage({ interaction } = {}) {
  assertInteraction(interaction);

  const text = 'Your agent can introduce itself and ask whether to continue.';
  if (text.length > 200) throw err('INTERNAL', 'opening text too long');

  const opening_id = `open:sha256:${sha256hex(`opening|${interaction.interaction_id}|${text}`)}`;
  const created_at = new Date(0).toISOString();

  // Machine-safe, deterministic key order.
  return {
    opening_id,
    interaction_id: interaction.interaction_id,
    text,
    created_at
  };
}
