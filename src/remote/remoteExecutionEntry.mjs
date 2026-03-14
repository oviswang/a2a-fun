// Remote Execution Runtime (primitive): Remote Execution Entry (minimal)
//
// Hard constraints:
// - no transport send-back here
// - no persistence / networking
// - must preserve frozen local execution semantics (executeInvocation + adaptExecutionResult)

import { executeInvocation } from '../execution/invocationExecutor.mjs';
import { adaptExecutionResult } from '../execution/resultAdapter.mjs';

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function safeFail({ code, invocation_id = null } = {}) {
  return {
    ok: false,
    invocation_id,
    executed: false,
    invocation_result: null,
    error: { code: String(code || 'FAILED') }
  };
}

function validatePayload(payload) {
  if (!isPlainObject(payload)) return { ok: false, code: 'INVALID_PAYLOAD' };
  if (payload.kind !== 'REMOTE_INVOCATION_REQUEST') return { ok: false, code: 'INVALID_KIND' };
  if (!isPlainObject(payload.invocation_request)) return { ok: false, code: 'INVALID_PAYLOAD' };
  return { ok: true };
}

function validateInvocationRequest(req) {
  if (!isPlainObject(req)) return { ok: false, code: 'INVALID_INVOCATION_REQUEST' };
  const required = ['invocation_id', 'capability_ref_id', 'friendship_id', 'capability_id'];
  for (const k of required) {
    if (typeof req[k] !== 'string' || req[k].trim() === '') return { ok: false, code: 'INVALID_INVOCATION_REQUEST' };
  }
  if (!isPlainObject(req.payload)) return { ok: false, code: 'INVALID_INVOCATION_REQUEST' };
  return { ok: true };
}

function validateFriendshipGate({ friendship_record, invocation_request }) {
  if (!isPlainObject(friendship_record)) return { ok: false, code: 'INVALID_FRIENDSHIP' };
  if (friendship_record.established !== true) return { ok: false, code: 'INVALID_FRIENDSHIP' };
  if (typeof friendship_record.friendship_id !== 'string' || friendship_record.friendship_id.trim() === '') return { ok: false, code: 'INVALID_FRIENDSHIP' };
  if (friendship_record.friendship_id !== invocation_request.friendship_id) return { ok: false, code: 'INVALID_FRIENDSHIP' };
  return { ok: true };
}

function boundCode(c) {
  const s = String(c || 'FAILED');
  return s.length > 64 ? s.slice(0, 64) : s;
}

/**
 * handleRemoteInvocation({ payload, registry, friendship_record })
 *
 * Payload shape:
 * { kind:'REMOTE_INVOCATION_REQUEST', invocation_request }
 *
 * Return shape:
 * { ok, invocation_id, executed, invocation_result, error }
 */
export function handleRemoteInvocation({ payload, registry, friendship_record } = {}) {
  const vp = validatePayload(payload);
  if (!vp.ok) return safeFail({ code: vp.code, invocation_id: payload?.invocation_request?.invocation_id ?? null });

  const invocation_request = payload.invocation_request;

  const vr = validateInvocationRequest(invocation_request);
  if (!vr.ok) return safeFail({ code: vr.code, invocation_id: invocation_request?.invocation_id ?? null });

  const vf = validateFriendshipGate({ friendship_record, invocation_request });
  if (!vf.ok) return safeFail({ code: vf.code, invocation_id: invocation_request.invocation_id });

  // Execute via frozen local execution runtime.
  const execution_result = executeInvocation({ registry, invocation_request });

  if (execution_result.executed !== true) {
    const code = boundCode(execution_result?.error?.code || 'EXECUTION_FAILED');
    return safeFail({ code, invocation_id: invocation_request.invocation_id });
  }

  try {
    const invocation_result = adaptExecutionResult({ invocation_request, execution_result });
    return {
      ok: true,
      invocation_id: invocation_request.invocation_id,
      executed: true,
      invocation_result,
      error: null
    };
  } catch (e) {
    return safeFail({ code: boundCode(e?.code || 'ADAPT_FAILED'), invocation_id: invocation_request.invocation_id });
  }
}
