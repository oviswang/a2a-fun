import crypto from 'node:crypto';

/**
 * Relay client wrapper.
 *
 * IMPORTANT:
 * - This module must remain syntactically valid in all supported Node.js runtimes.
 * - It is a thin wrapper over the process-global v0.1 relay singleton.
 * - It preserves the public API shape: { connect, relay, close, isConnected }.
 */
export function createRelayClient({ relayUrl, nodeId, onForward, onDisconnect, registrationMode = 'v1', sessionId, onAck } = {}) {
  if (!relayUrl) throw new Error('relayClient: missing relayUrl');
  if (!nodeId) throw new Error('relayClient: missing nodeId');
  if (typeof onForward !== 'function') throw new Error('relayClient: missing onForward');
  if (typeof onAck !== 'undefined' && typeof onAck !== 'function') throw new Error('relayClient: onAck must be function');
  if (registrationMode !== 'v1' && registrationMode !== 'v2') throw new Error('relayClient: invalid registrationMode');

  // Keep for compatibility (not used by v0.1 singleton path).
  void sessionId;

  let connected = false;
  let unsubscribe = null;

  async function connect() {
    const { initRelaySingleton } = await import('../network/relaySingleton.mjs');
    const relay = initRelaySingleton({ node_id: nodeId, relayCandidates: [relayUrl], allowLocalRelay: true });

    if (!unsubscribe) {
      unsubscribe = relay.subscribe('*', ({ from, payload, topic }) => {
        // Best-effort compatibility:
        // - Forward relay.deliver payloads to caller as opaque payload.
        // - Preserve old behavior: { from, payload }
        try {
          onForward({ from, payload });
        } catch {}
        // Acks (if any) are not part of v0.1 relay singleton; keep hook for compatibility.
        try {
          if (topic === 'ack' && typeof onAck === 'function') onAck(payload);
        } catch {}
      });
    }

    await relay.ensureConnected();
    connected = true;
  }

  async function relay({ to, payload }) {
    if (!to || typeof to !== 'string') {
      const e = new Error('relayClient.relay: to must be string');
      e.code = 'INVALID_TO';
      throw e;
    }

    await connect();

    const { initRelaySingleton } = await import('../network/relaySingleton.mjs');
    const relay = initRelaySingleton({ node_id: nodeId, relayCandidates: [relayUrl], allowLocalRelay: true });

    // Keep message_id stable-ish per call.
    const message_id = `msg:${crypto.randomUUID()}`;
    const out = await relay.send({ to, topic: 'relay.forward', payload, message_id });
    if (!out.ok) {
      const e = new Error('relayClient.relay: not connected');
      e.code = 'NOT_CONNECTED';
      throw e;
    }
  }

  async function close() {
    try { if (typeof unsubscribe === 'function') unsubscribe(); } catch {}
    unsubscribe = null;
    connected = false;
    try { if (typeof onDisconnect === 'function') onDisconnect(); } catch {}
  }

  function isConnected() {
    return !!connected;
  }

  return { connect, relay, close, isConnected };
}
