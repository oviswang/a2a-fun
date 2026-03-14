/**
 * Minimal relay inbound bridge.
 *
 * Expects forwarded shape:
 *   { from, payload }
 *
 * Forwards payload to onInbound(payload).
 *
 * Hard rules:
 * - no protocol interpretation
 * - no envelope mutation
 * - no friendship logic
 */
export async function handleRelayInbound(message, { onInbound, onRemoteHumanJoinSignal } = {}) {
  if (typeof onInbound !== 'function') {
    const e = new Error('handleRelayInbound: missing onInbound');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  if (!message || typeof message !== 'object') {
    const e = new Error('relayInbound: invalid message');
    e.code = 'INVALID_MESSAGE';
    throw e;
  }
  if (typeof message.from !== 'string' || !('payload' in message)) {
    const e = new Error('relayInbound: invalid shape');
    e.code = 'INVALID_MESSAGE';
    throw e;
  }

  const payload = message.payload;

  // Minimal inbound wiring hook: allow dispatch of REMOTE_HUMAN_JOIN_SIGNAL.
  // Default behavior remains unchanged unless onRemoteHumanJoinSignal is provided.
  if (
    onRemoteHumanJoinSignal &&
    typeof onRemoteHumanJoinSignal === 'function' &&
    payload &&
    typeof payload === 'object' &&
    payload.kind === 'REMOTE_HUMAN_JOIN_SIGNAL'
  ) {
    return onRemoteHumanJoinSignal({ payload, from: message.from });
  }

  return onInbound(payload);
}
