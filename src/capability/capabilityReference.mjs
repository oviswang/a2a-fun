// Capability Sharing Layer (primitive): invocation-ready capability reference (minimal)
//
// Hard constraints:
// - friendship-gated context only
// - deterministic, machine-safe output only
// - no invocation execution, no persistence, no networking
// - no tasks/mailbox/marketplace

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

function assertFriendshipRecord(fr) {
  if (!fr || typeof fr !== 'object' || Array.isArray(fr)) throw err('INVALID_INPUT', 'friendship_record must be object');
  assertNonEmptyString(fr.friendship_id, 'friendship_record.friendship_id');
  if (fr.established !== true) throw err('INVALID_FRIENDSHIP', 'friendship_record.established must be true');
}

function assertDiscoveredCapability(cap) {
  if (!cap || typeof cap !== 'object' || Array.isArray(cap)) throw err('INVALID_INPUT', 'capability must be object');
  assertNonEmptyString(cap.capability_id, 'capability.capability_id');
  assertNonEmptyString(cap.name, 'capability.name');
  assertNonEmptyString(cap.summary, 'capability.summary');
}

/**
 * Deterministic invocation-ready capability reference.
 *
 * Shape:
 * {
 *   capability_ref_id,
 *   friendship_id,
 *   capability_id,
 *   name,
 *   invocation_ready,
 *   created_at
 * }
 */
export function createCapabilityReference({ friendship_record, capability } = {}) {
  assertFriendshipRecord(friendship_record);
  assertDiscoveredCapability(capability);

  const capability_ref_id = `capref:sha256:${sha256hex(`capref|${friendship_record.friendship_id}|${capability.capability_id}`)}`;
  const created_at = new Date(0).toISOString();

  return {
    capability_ref_id,
    friendship_id: friendship_record.friendship_id,
    capability_id: capability.capability_id,
    name: capability.name,
    invocation_ready: true,
    created_at
  };
}
