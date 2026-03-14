// Discovery Layer (runtime primitive): Discovery -> Friendship handoff baseline
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

function assertInteraction(interaction) {
  if (!interaction || typeof interaction !== 'object' || Array.isArray(interaction)) throw err('INVALID_INPUT', 'interaction must be object');
  assertNonEmptyString(interaction.interaction_id, 'interaction.interaction_id');
  // Minimal surface checks only; do not broaden scope.
  if (!Array.isArray(interaction.action_options)) throw err('INVALID_INPUT', 'interaction.action_options must be array');
  assertNonEmptyString(interaction.default_action, 'interaction.default_action');
}

/**
 * createDiscoveryFriendshipHandoff({ interaction, action })
 *
 * Rules:
 * - only action "PROCEED" creates a handoff object
 * - action "SKIP" produces no handoff (returns null)
 * - any other action fails closed
 */
export function createDiscoveryFriendshipHandoff({ interaction, action } = {}) {
  assertInteraction(interaction);
  assertNonEmptyString(action, 'action');

  if (action === 'SKIP') return null;
  if (action !== 'PROCEED') throw err('INVALID_ACTION', 'action not allowed');

  const material = `handoff|${interaction.interaction_id}|${action}|FRIENDSHIP_TRIGGER`;
  const handoff_id = `dhand:sha256:${sha256hex(material)}`;

  // Machine-safe, deterministic key order.
  return {
    handoff_id,
    interaction_id: interaction.interaction_id,
    action,
    proceed: true,
    target: 'FRIENDSHIP_TRIGGER'
  };
}
