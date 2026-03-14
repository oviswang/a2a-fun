// Discovery Layer (runtime primitive): human-observable interaction baseline
//
// Hard constraints:
// - no real UI
// - no networking
// - no persistence
// - no capability/task logic
// - machine-safe output only

import { createHash } from 'node:crypto';

export const DISCOVERY_ACTIONS = Object.freeze({
  PROCEED: 'PROCEED',
  SKIP: 'SKIP'
});

const ACTION_ALLOWLIST = Object.freeze(Object.values(DISCOVERY_ACTIONS));

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

function assertPreview(preview) {
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) throw err('INVALID_INPUT', 'preview must be object');
  assertNonEmptyString(preview.preview_id, 'preview.preview_id');
  assertNonEmptyString(preview.discovery_candidate_id, 'preview.discovery_candidate_id');
}

/**
 * Deterministic, machine-safe interaction object derived from a conversation preview.
 *
 * Shape:
 * {
 *   interaction_id,
 *   preview_id,
 *   action_options,
 *   default_action
 * }
 */
export function createDiscoveryInteraction({ preview } = {}) {
  assertPreview(preview);

  const action_options = [DISCOVERY_ACTIONS.PROCEED, DISCOVERY_ACTIONS.SKIP];
  for (const a of action_options) {
    if (!ACTION_ALLOWLIST.includes(a)) throw err('INTERNAL', 'action not allowlisted');
  }

  const default_action = DISCOVERY_ACTIONS.SKIP;
  if (!ACTION_ALLOWLIST.includes(default_action)) throw err('INTERNAL', 'default_action not allowlisted');

  const material = `interaction|${preview.preview_id}|${action_options.join(',')}|${default_action}`;
  const interaction_id = `dint:sha256:${sha256hex(material)}`;

  // Machine-safe, deterministic key order.
  return {
    interaction_id,
    preview_id: preview.preview_id,
    action_options,
    default_action
  };
}
