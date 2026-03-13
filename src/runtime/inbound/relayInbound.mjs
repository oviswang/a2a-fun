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
export async function handleRelayInbound(message, { onInbound } = {}) {
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

  return onInbound(message.payload);
}
