// Execution Runtime Layer (primitive): Result Adapter (minimal)
//
// Hard constraints:
// - must use frozen capability invocation result primitive semantics
// - no networking / persistence / orchestration
// - deterministic, machine-safe adaptation

import { createCapabilityInvocationResult } from '../capability/capabilityInvocationResult.mjs';

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function assertNonEmptyString(v, name) {
  if (typeof v !== 'string' || v.trim() === '') throw err('INVALID_INPUT', `missing ${name}`);
}

function assertInvocationRequest(req) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) throw err('INVALID_INPUT', 'invocation_request must be object');
  assertNonEmptyString(req.invocation_id, 'invocation_request.invocation_id');
}

function assertExecutionResult(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw err('INVALID_EXECUTION_RESULT', 'execution_result must be object');
  assertNonEmptyString(r.invocation_id, 'execution_result.invocation_id');
  if (typeof r.executed !== 'boolean') throw err('INVALID_EXECUTION_RESULT', 'execution_result.executed must be boolean');

  const hasRaw = Object.prototype.hasOwnProperty.call(r, 'raw_result');
  const hasErr = Object.prototype.hasOwnProperty.call(r, 'error');
  if (!hasRaw) throw err('INVALID_EXECUTION_RESULT', 'missing execution_result.raw_result');
  if (!hasErr) throw err('INVALID_EXECUTION_RESULT', 'missing execution_result.error');

  if (r.executed === true) {
    if (r.error !== null) throw err('INVALID_EXECUTION_RESULT', 'error must be null when executed=true');
  } else {
    if (r.raw_result !== null) throw err('INVALID_EXECUTION_RESULT', 'raw_result must be null when executed=false');
    if (!r.error || typeof r.error !== 'object' || Array.isArray(r.error)) throw err('INVALID_EXECUTION_RESULT', 'error must be object when executed=false');
    assertNonEmptyString(r.error.code, 'execution_result.error.code');
  }
}

/**
 * adaptExecutionResult({ invocation_request, execution_result })
 *
 * Adapts raw execution output (from executeInvocation) into a frozen
 * capability invocation result primitive.
 */
export function adaptExecutionResult({ invocation_request, execution_result } = {}) {
  assertInvocationRequest(invocation_request);
  assertExecutionResult(execution_result);

  if (execution_result.invocation_id !== invocation_request.invocation_id) {
    throw err('INVALID_EXECUTION_RESULT', 'invocation_id mismatch');
  }

  if (execution_result.executed === true) {
    // Must be a bounded machine-safe object per frozen createCapabilityInvocationResult.
    // If invalid, the primitive will throw with code INVALID_RESULT.
    return createCapabilityInvocationResult({
      invocation_request,
      ok: true,
      result: execution_result.raw_result,
      error: null
    });
  }

  return createCapabilityInvocationResult({
    invocation_request,
    ok: false,
    result: null,
    error: { code: execution_result.error.code }
  });
}
