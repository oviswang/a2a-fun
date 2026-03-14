// Discovery Layer (runtime primitive): conversation preview baseline
//
// Hard constraints:
// - no real conversation execution
// - no human interaction runtime
// - no persistence
// - no capability/task logic
// - machine-safe output only

import { createHash } from 'node:crypto';

export const DISCOVERY_PREVIEW_SAFETY_NOTES = Object.freeze({
  HUMAN_REVIEW_REQUIRED: 'HUMAN_REVIEW_REQUIRED'
});

const SAFETY_NOTES_ALLOWLIST = Object.freeze(Object.values(DISCOVERY_PREVIEW_SAFETY_NOTES));

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function assertNonEmptyString(v, name) {
  if (typeof v !== 'string' || v.trim() === '') throw err('INVALID_INPUT', `missing ${name}`);
}

function assertShortString(v, name, max = 120) {
  assertNonEmptyString(v, name);
  if (v.length > max) throw err('INVALID_INPUT', `${name} too long`);
}

function sha256hex(s) {
  return createHash('sha256').update(String(s), 'utf8').digest('hex');
}

function assertCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw err('INVALID_INPUT', 'candidate must be object');
  assertNonEmptyString(candidate.discovery_candidate_id, 'candidate.discovery_candidate_id');
}

function assertCompatibility(compatibility) {
  if (!compatibility || typeof compatibility !== 'object' || Array.isArray(compatibility)) throw err('INVALID_INPUT', 'compatibility must be object');
  assertNonEmptyString(compatibility.discovery_candidate_id, 'compatibility.discovery_candidate_id');
  if (!Number.isInteger(compatibility.score) || compatibility.score < 0 || compatibility.score > 100) {
    throw err('INVALID_INPUT', 'compatibility.score out of bounds');
  }
  if (!Array.isArray(compatibility.reasons)) throw err('INVALID_INPUT', 'compatibility.reasons must be array');
  // No free-form reason validation here beyond basic type/size; reasons are allowlisted in the compatibility primitive.
  if (compatibility.reasons.length > 5) throw err('INVALID_INPUT', 'compatibility.reasons too many');
  for (const r of compatibility.reasons) {
    assertNonEmptyString(r, 'compatibility.reasons[]');
    if (r.length > 64) throw err('INVALID_INPUT', 'compatibility.reasons[] too long');
  }
}

/**
 * Deterministic conversation preview derived from a discovery candidate + compatibility result.
 *
 * Shape:
 * {
 *   preview_id,
 *   discovery_candidate_id,
 *   headline,
 *   opening_line,
 *   safety_notes
 * }
 */
export function createDiscoveryConversationPreview({ candidate, compatibility } = {}) {
  assertCandidate(candidate);
  assertCompatibility(compatibility);

  if (candidate.discovery_candidate_id !== compatibility.discovery_candidate_id) {
    throw err('MISMATCH', 'candidate/compatibility discovery_candidate_id mismatch');
  }

  // Minimal deterministic baseline copy.
  const headline = 'Known peer available';
  const opening_line = 'Your agent can start a lightweight introduction.';
  const safety_notes = [DISCOVERY_PREVIEW_SAFETY_NOTES.HUMAN_REVIEW_REQUIRED];

  assertShortString(headline, 'headline', 120);
  assertShortString(opening_line, 'opening_line', 200);

  for (const n of safety_notes) {
    if (!SAFETY_NOTES_ALLOWLIST.includes(n)) throw err('INTERNAL', 'safety note not allowlisted');
  }

  const material = `preview|${candidate.discovery_candidate_id}|${compatibility.score}|${compatibility.reasons.join(',')}`;
  const preview_id = `dprev:sha256:${sha256hex(material)}`;

  // Machine-safe, deterministic key order.
  return {
    preview_id,
    discovery_candidate_id: candidate.discovery_candidate_id,
    headline,
    opening_line,
    safety_notes
  };
}
