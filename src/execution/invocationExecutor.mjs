// Execution Runtime Layer (primitive): Invocation Executor (minimal)
//
// Hard constraints:
// - no result adapter
// - no networking / persistence
// - no orchestration
// - machine-safe, deterministic output shape

import { getCapabilityHandler } from './capabilityHandlerRegistry.mjs';

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function assertNonEmptyString(v, name) {
  if (typeof v !== 'string' || v.trim() === '') throw err('INVALID_INVOCATION_REQUEST', `missing ${name}`);
}

function assertPlainObject(v, name) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw err('INVALID_INVOCATION_REQUEST', `${name} must be plain object`);
}

function assertInvocationRequest(req) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) throw err('INVALID_INVOCATION_REQUEST', 'invocation_request must be object');
  assertNonEmptyString(req.invocation_id, 'invocation_id');
  assertNonEmptyString(req.capability_ref_id, 'capability_ref_id');
  assertNonEmptyString(req.friendship_id, 'friendship_id');
  assertNonEmptyString(req.capability_id, 'capability_id');
  assertPlainObject(req.payload, 'payload');
}

function toMachineSafeError(code) {
  return { code: String(code || 'UNKNOWN_ERROR') };
}

/**
 * executeInvocation({ registry, invocation_request })
 *
 * Returns a machine-safe raw execution result:
 * {
 *   invocation_id,
 *   executed,
 *   raw_result,
 *   error
 * }
 */
export function executeInvocation({ registry, invocation_request } = {}) {
  assertInvocationRequest(invocation_request);

  const handler = getCapabilityHandler({ registry, capability_id: invocation_request.capability_id });
  if (!handler) {
    return {
      invocation_id: invocation_request.invocation_id,
      executed: false,
      raw_result: null,
      error: toMachineSafeError('HANDLER_NOT_FOUND')
    };
  }

  try {
    const raw_result = handler(invocation_request.payload);
    return {
      invocation_id: invocation_request.invocation_id,
      executed: true,
      raw_result,
      error: null
    };
  } catch {
    return {
      invocation_id: invocation_request.invocation_id,
      executed: false,
      raw_result: null,
      error: toMachineSafeError('HANDLER_EXECUTION_FAILED')
    };
  }
}
