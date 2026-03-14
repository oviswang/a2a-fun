// Remote Execution Runtime (primitive): Remote Result Return (minimal)
//
// Hard constraints:
// - does not modify frozen transport semantics
// - does not modify invocation result semantics
// - no persistence / mailbox / retry / orchestration

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function validateTransport(transport) {
  if (typeof transport !== 'function') return { ok: false, code: 'INVALID_INPUT' };
  return { ok: true };
}

function validatePeer(peer) {
  if (!isPlainObject(peer)) return { ok: false, code: 'INVALID_INPUT' };
  if (typeof peer.peerUrl !== 'string' || peer.peerUrl.trim() === '') return { ok: false, code: 'INVALID_INPUT' };
  return { ok: true };
}

function validateInvocationResult(r) {
  if (!isPlainObject(r)) return { ok: false, code: 'INVALID_INVOCATION_RESULT' };
  if (typeof r.invocation_id !== 'string' || r.invocation_id.trim() === '') return { ok: false, code: 'INVALID_INVOCATION_RESULT' };
  if (typeof r.ok !== 'boolean') return { ok: false, code: 'INVALID_INVOCATION_RESULT' };

  // Minimal compatibility checks (do not redesign semantics):
  // - ok=true => result must be plain object, error must be null
  // - ok=false => result must be null, error must be {code}
  if (r.ok === true) {
    if (!isPlainObject(r.result)) return { ok: false, code: 'INVALID_INVOCATION_RESULT' };
    if (r.error !== null) return { ok: false, code: 'INVALID_INVOCATION_RESULT' };
  } else {
    if (r.result !== null) return { ok: false, code: 'INVALID_INVOCATION_RESULT' };
    if (!isPlainObject(r.error) || typeof r.error.code !== 'string' || r.error.code.trim() === '') return { ok: false, code: 'INVALID_INVOCATION_RESULT' };
  }

  return { ok: true };
}

function toMachineSafeErrorCode(e) {
  const code = (e && typeof e === 'object' && typeof e.code === 'string' && e.code.trim()) ? e.code.trim() : 'TRANSPORT_FAILED';
  return code.length > 64 ? code.slice(0, 64) : code;
}

/**
 * Node B send-side helper.
 *
 * sendRemoteInvocationResult({ transport, peer, invocation_result })
 *
 * Carries opaque payload:
 * { kind:'REMOTE_INVOCATION_RESULT', invocation_result }
 */
export async function sendRemoteInvocationResult({ transport, peer, invocation_result } = {}) {
  const vt = validateTransport(transport);
  if (!vt.ok) return { ok: false, transport_used: null, sent: false, error: { code: vt.code } };

  const vp = validatePeer(peer);
  if (!vp.ok) return { ok: false, transport_used: null, sent: false, error: { code: vp.code } };

  const vr = validateInvocationResult(invocation_result);
  if (!vr.ok) return { ok: false, transport_used: null, sent: false, error: { code: vr.code } };

  const payload = {
    kind: 'REMOTE_INVOCATION_RESULT',
    invocation_result
  };

  try {
    const out = await transport({
      peerUrl: peer.peerUrl,
      payload,
      relayAvailable: !!peer.relayAvailable,
      timeoutMs: peer.timeoutMs,
      relayUrl: peer.relayUrl,
      nodeId: peer.nodeId,
      relayTo: peer.relayTo
    });

    const transport_used = (out && typeof out === 'object' && typeof out.transport === 'string') ? out.transport : null;

    return { ok: true, transport_used, sent: true, error: null };
  } catch (e) {
    return { ok: false, transport_used: null, sent: false, error: { code: toMachineSafeErrorCode(e) } };
  }
}

/**
 * Node A receive-side helper.
 *
 * handleRemoteInvocationResult({ payload })
 */
export function handleRemoteInvocationResult({ payload } = {}) {
  if (!isPlainObject(payload)) {
    return { ok: false, invocation_id: null, invocation_result: null, error: { code: 'INVALID_PAYLOAD' } };
  }
  if (payload.kind !== 'REMOTE_INVOCATION_RESULT') {
    return { ok: false, invocation_id: null, invocation_result: null, error: { code: 'INVALID_KIND' } };
  }

  const invocation_result = payload.invocation_result;
  const vr = validateInvocationResult(invocation_result);
  if (!vr.ok) {
    return { ok: false, invocation_id: invocation_result?.invocation_id ?? null, invocation_result: null, error: { code: vr.code } };
  }

  return { ok: true, invocation_id: invocation_result.invocation_id, invocation_result, error: null };
}
