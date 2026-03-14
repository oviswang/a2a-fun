// Capability Sharing Layer (primitive): capability advertisement (minimal)
//
// Hard constraints:
// - friendship-gated context only
// - deterministic, machine-safe output only
// - no discovery, no invocation, no persistence
// - no networking, no tasks/mailbox/marketplace

import { createHash } from 'node:crypto';

const LIMITS = Object.freeze({
  name: 64,
  summary: 160,
  input_schema_ref: 128,
  output_schema_ref: 128
});

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function assertNonEmptyString(v, name) {
  if (typeof v !== 'string' || v.trim() === '') throw err('INVALID_INPUT', `missing ${name}`);
}

function assertBoundedString(v, name, maxLen) {
  assertNonEmptyString(v, name);
  if (v.length > maxLen) throw err('INVALID_INPUT', `${name} too long`);
}

function sha256hex(s) {
  return createHash('sha256').update(String(s), 'utf8').digest('hex');
}

function assertFriendshipRecord(fr) {
  if (!fr || typeof fr !== 'object' || Array.isArray(fr)) throw err('INVALID_INPUT', 'friendship_record must be object');
  assertNonEmptyString(fr.friendship_id, 'friendship_record.friendship_id');
  if (fr.established !== true) throw err('INVALID_FRIENDSHIP', 'friendship_record.established must be true');
}

/**
 * Deterministic capability advertisement derived from a friendship-gated context.
 *
 * Shape:
 * {
 *   capability_id,
 *   friendship_id,
 *   name,
 *   summary,
 *   input_schema_ref,
 *   output_schema_ref,
 *   created_at
 * }
 */
export function createCapabilityAdvertisement({
  friendship_record,
  name,
  summary,
  input_schema_ref,
  output_schema_ref
} = {}) {
  assertFriendshipRecord(friendship_record);

  assertBoundedString(name, 'name', LIMITS.name);
  assertBoundedString(summary, 'summary', LIMITS.summary);
  assertBoundedString(input_schema_ref, 'input_schema_ref', LIMITS.input_schema_ref);
  assertBoundedString(output_schema_ref, 'output_schema_ref', LIMITS.output_schema_ref);

  const material = `capability|${friendship_record.friendship_id}|${name}|${input_schema_ref}|${output_schema_ref}`;
  const capability_id = `cap:sha256:${sha256hex(material)}`;

  const created_at = new Date(0).toISOString();

  // Machine-safe, deterministic key order.
  return {
    capability_id,
    friendship_id: friendship_record.friendship_id,
    name,
    summary,
    input_schema_ref,
    output_schema_ref,
    created_at
  };
}
