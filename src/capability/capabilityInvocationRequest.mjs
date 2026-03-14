// Capability Invocation Layer (primitive): capability invocation request (minimal)
//
// Hard constraints:
// - deterministic, machine-safe output only
// - friendship-gated via capability_reference
// - no execution, no persistence, no networking
// - no mailbox/orchestration

import { createHash } from 'node:crypto';

const LIMITS = Object.freeze({
  maxKeys: 10,
  keyLen: 64,
  strValLen: 160
});

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

function stableCopyObject(obj) {
  const keys = Object.keys(obj).sort();
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

function stableStringifyObject(obj) {
  return JSON.stringify(stableCopyObject(obj));
}

function assertCapabilityReference(ref) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) throw err('INVALID_INPUT', 'capability_reference must be object');
  assertNonEmptyString(ref.capability_ref_id, 'capability_reference.capability_ref_id');
  assertNonEmptyString(ref.friendship_id, 'capability_reference.friendship_id');
  assertNonEmptyString(ref.capability_id, 'capability_reference.capability_id');
  if (ref.invocation_ready !== true) throw err('INVALID_REFERENCE', 'capability_reference.invocation_ready must be true');
}

function assertPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw err('INVALID_PAYLOAD', 'payload must be plain object');
  const keys = Object.keys(payload);
  if (keys.length > LIMITS.maxKeys) throw err('INVALID_PAYLOAD', 'payload too many keys');

  for (const k of keys) {
    assertNonEmptyString(k, 'payload key');
    if (k.length > LIMITS.keyLen) throw err('INVALID_PAYLOAD', 'payload key too long');

    const v = payload[k];
    const t = typeof v;
    if (v === null || t === 'undefined') throw err('INVALID_PAYLOAD', 'payload value must be primitive');
    if (t === 'string') {
      if (v.length > LIMITS.strValLen) throw err('INVALID_PAYLOAD', 'payload string value too long');
    } else if (t === 'number' || t === 'boolean') {
      // ok
    } else {
      // No nested objects/arrays/functions.
      throw err('INVALID_PAYLOAD', 'payload value must be primitive');
    }
  }
}

/**
 * Deterministic invocation request derived from an invocation-ready capability reference.
 *
 * Shape:
 * {
 *   invocation_id,
 *   capability_ref_id,
 *   friendship_id,
 *   capability_id,
 *   payload,
 *   created_at
 * }
 */
export function createCapabilityInvocationRequest({ capability_reference, payload } = {}) {
  assertCapabilityReference(capability_reference);
  assertPayload(payload);

  const stablePayload = stableCopyObject(payload);
  const payloadStr = JSON.stringify(stablePayload);
  const invocation_id = `inv:sha256:${sha256hex(`invocation|${capability_reference.capability_ref_id}|${payloadStr}`)}`;
  const created_at = new Date(0).toISOString();

  return {
    invocation_id,
    capability_ref_id: capability_reference.capability_ref_id,
    friendship_id: capability_reference.friendship_id,
    capability_id: capability_reference.capability_id,
    payload: stablePayload,
    created_at
  };
}
