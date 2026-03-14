// Capability Invocation Layer (primitive): invocation result (minimal)
//
// Hard constraints:
// - deterministic, machine-safe output only
// - no execution, no persistence, no networking
// - bounded result/error only

const LIMITS = Object.freeze({
  maxKeys: 10,
  keyLen: 64,
  strValLen: 160,
  errorCodeLen: 64
});

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function assertNonEmptyString(v, name) {
  if (typeof v !== 'string' || v.trim() === '') throw err('INVALID_INPUT', `missing ${name}`);
}

function stableCopyObject(obj) {
  const keys = Object.keys(obj).sort();
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

function assertInvocationRequest(req) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) throw err('INVALID_INPUT', 'invocation_request must be object');
  assertNonEmptyString(req.invocation_id, 'invocation_request.invocation_id');
}

function assertResultObject(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw err('INVALID_RESULT', 'result must be plain object');
  const keys = Object.keys(result);
  if (keys.length > LIMITS.maxKeys) throw err('INVALID_RESULT', 'result too many keys');
  for (const k of keys) {
    assertNonEmptyString(k, 'result key');
    if (k.length > LIMITS.keyLen) throw err('INVALID_RESULT', 'result key too long');
    const v = result[k];
    const t = typeof v;
    if (v === null || t === 'undefined') throw err('INVALID_RESULT', 'result value must be primitive');
    if (t === 'string') {
      if (v.length > LIMITS.strValLen) throw err('INVALID_RESULT', 'result string value too long');
    } else if (t === 'number' || t === 'boolean') {
      // ok
    } else {
      throw err('INVALID_RESULT', 'result value must be primitive');
    }
  }
}

function assertErrorObject(errorObj) {
  if (!errorObj || typeof errorObj !== 'object' || Array.isArray(errorObj)) throw err('INVALID_ERROR', 'error must be object');
  assertNonEmptyString(errorObj.code, 'error.code');
  if (errorObj.code.length > LIMITS.errorCodeLen) throw err('INVALID_ERROR', 'error.code too long');
  // Only allow {code} for machine-safety in this phase.
  const keys = Object.keys(errorObj);
  if (keys.length !== 1 || keys[0] !== 'code') throw err('INVALID_ERROR', 'error must be {code} only');
}

/**
 * Deterministic capability invocation result.
 *
 * Shape:
 * {
 *   invocation_id,
 *   ok,
 *   result,
 *   error,
 *   created_at
 * }
 */
export function createCapabilityInvocationResult({ invocation_request, ok, result, error } = {}) {
  assertInvocationRequest(invocation_request);
  if (typeof ok !== 'boolean') throw err('INVALID_INPUT', 'ok must be boolean');

  if (ok === true) {
    if (error !== null && typeof error !== 'undefined') throw err('INVALID_INPUT', 'error must be null when ok=true');
    assertResultObject(result);

    return {
      invocation_id: invocation_request.invocation_id,
      ok: true,
      result: stableCopyObject(result),
      error: null,
      created_at: new Date(0).toISOString()
    };
  }

  // ok === false
  if (result !== null && typeof result !== 'undefined') throw err('INVALID_INPUT', 'result must be null when ok=false');
  assertErrorObject(error);

  return {
    invocation_id: invocation_request.invocation_id,
    ok: false,
    result: null,
    error: { code: error.code },
    created_at: new Date(0).toISOString()
  };
}
