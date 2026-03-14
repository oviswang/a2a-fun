// Remote Execution Runtime (primitive): Remote Invocation Transport (minimal)
//
// Hard constraints:
// - does not modify frozen transport semantics
// - does not interpret protocol/envelope meaning
// - no remote execution entry
// - no result return handling
// - no persistence / mailbox / orchestration

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function validateInvocationRequest(req) {
  if (!isPlainObject(req)) return { ok: false, code: 'INVALID_INPUT', reason: 'invocation_request must be object' };

  const required = ['invocation_id', 'capability_ref_id', 'friendship_id', 'capability_id'];
  for (const k of required) {
    if (typeof req[k] !== 'string' || req[k].trim() === '') {
      return { ok: false, code: 'INVALID_INPUT', reason: `missing ${k}` };
    }
  }

  if (!isPlainObject(req.payload)) return { ok: false, code: 'INVALID_INPUT', reason: 'payload must be plain object' };

  return { ok: true };
}

function validatePeer(peer) {
  if (!isPlainObject(peer)) return { ok: false, code: 'INVALID_INPUT', reason: 'peer must be object' };
  if (typeof peer.peerUrl !== 'string' || peer.peerUrl.trim() === '') {
    return { ok: false, code: 'INVALID_INPUT', reason: 'missing peer.peerUrl' };
  }
  return { ok: true };
}

function validateTransport(transport) {
  if (typeof transport !== 'function') return { ok: false, code: 'INVALID_INPUT', reason: 'transport must be function' };
  return { ok: true };
}

function toMachineSafeErrorCode(e) {
  const code = (e && typeof e === 'object' && typeof e.code === 'string' && e.code.trim()) ? e.code.trim() : 'TRANSPORT_FAILED';
  // Bound the code length (defensive; do not leak large strings)
  return code.length > 64 ? code.slice(0, 64) : code;
}

/**
 * sendRemoteInvocation({ transport, peer, invocation_request })
 *
 * Carries an opaque runtime payload over the frozen transport baseline.
 * Payload shape:
 * { kind: 'REMOTE_INVOCATION_REQUEST', invocation_request }
 *
 * Returns machine-safe deterministic send result:
 * { ok, transport_used, sent, error }
 */
export async function sendRemoteInvocation({ transport, peer, invocation_request } = {}) {
  const vt = validateTransport(transport);
  if (!vt.ok) return { ok: false, transport_used: null, sent: false, error: { code: vt.code } };

  const vp = validatePeer(peer);
  if (!vp.ok) return { ok: false, transport_used: null, sent: false, error: { code: vp.code } };

  const vr = validateInvocationRequest(invocation_request);
  if (!vr.ok) return { ok: false, transport_used: null, sent: false, error: { code: vr.code } };

  const payload = {
    kind: 'REMOTE_INVOCATION_REQUEST',
    invocation_request
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

    return {
      ok: true,
      transport_used,
      sent: true,
      error: null
    };
  } catch (e) {
    return {
      ok: false,
      transport_used: null,
      sent: false,
      error: { code: toMachineSafeErrorCode(e) }
    };
  }
}
