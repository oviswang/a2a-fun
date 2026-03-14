import crypto from 'node:crypto';

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Minimal relay client.
 *
 * Responsibilities:
 * - outbound WebSocket connect
 * - register node_id
 * - receive forwarded messages { from, payload }
 * - pass forwarded payloads to a caller-provided callback
 *
 * Non-goals:
 * - protocol interpretation
 * - friendship logic
 * - transport selection/orchestration
 * - persistence / queue / retry
 */
export function createRelayClient({ relayUrl, nodeId, onForward, onDisconnect, registrationMode = 'v1', sessionId, onAck } = {}) {
  if (!relayUrl) throw new Error('relayClient: missing relayUrl');
  if (!nodeId) throw new Error('relayClient: missing nodeId');
  if (typeof onForward !== 'function') throw new Error('relayClient: missing onForward');
  if (typeof onAck !== 'undefined' && typeof onAck !== 'function') throw new Error('relayClient: onAck must be function');

  if (registrationMode !== 'v1' && registrationMode !== 'v2') throw new Error('relayClient: invalid registrationMode');

  // v2 requires a stable per-client session_id. Generate once per client instance if not provided.
  const stableSessionId = registrationMode === 'v2'
    ? (typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : `sess:${crypto.randomUUID()}`)
    : null;

  let ws = null;
  let connected = false;

  async function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    ws = new WebSocket(relayUrl);

    // Attach message handler BEFORE registration send (avoid missing 'registered').
    let didRegister = false;
    const registeredPromise = new Promise((resolve) => {
      ws.addEventListener(
        'message',
        (ev) => {
          const msg = safeJsonParse(String(ev.data));
          if (!msg || typeof msg !== 'object') return;

          // Registration ack.
          if (registrationMode === 'v1') {
            if (msg.ok === true && msg.type === 'registered' && msg.node === nodeId) {
              didRegister = true;
              resolve(true);
              return;
            }
          }

          if (registrationMode === 'v2') {
            if (msg.ok === true && msg.type === 'registered' && msg.node_id === nodeId && msg.session_id === stableSessionId) {
              didRegister = true;
              resolve(true);
              return;
            }
          }

          // Relay v2 ack messages.
          if (msg.type === 'ack') {
            if (typeof onAck === 'function') onAck(msg);
            return;
          }

          // Forwarded messages are opaque: { from, payload }
          if (typeof msg.from === 'string' && 'payload' in msg) {
            onForward({ from: msg.from, payload: msg.payload });
          }
        },
        { once: false }
      );
    });

    ws.addEventListener(
      'close',
      () => {
        connected = false;
        if (typeof onDisconnect === 'function') onDisconnect();
      },
      { once: true }
    );

    // Wait for socket open (or early connect error) AFTER handlers are attached.
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    connected = true;

    // Register (send only after open).
    if (registrationMode === 'v1') {
      ws.send(JSON.stringify({ type: 'register', node: nodeId }));
    } else {
      ws.send(JSON.stringify({ type: 'register', node_id: nodeId, session_id: stableSessionId }));
    }

    // Fail closed if registration never completes quickly.
    const timer = setTimeout(() => {
      // handled by the race promise below
    }, 1);
    clearTimeout(timer);

    let timeoutId;
    try {
      await Promise.race([
        registeredPromise,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            if (didRegister) return;
            const e = new Error('relayClient.connect: register timeout');
            e.code = 'REGISTER_TIMEOUT';
            reject(e);
          }, 1000);
        })
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async function relay({ to, payload }) {
    if (!to || typeof to !== 'string') {
      const e = new Error('relayClient.relay: to must be string');
      e.code = 'INVALID_TO';
      throw e;
    }
    await connect();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      const e = new Error('relayClient.relay: not connected');
      e.code = 'NOT_CONNECTED';
      throw e;
    }
    ws.send(JSON.stringify({ type: 'relay', to, payload }));
  }

  async function close() {
    if (!ws) return;
    await new Promise((resolve) => {
      try {
        ws.addEventListener('close', resolve, { once: true });
        ws.close();
      } catch {
        resolve();
      }
    });
    ws = null;
    connected = false;
  }

  function isConnected() {
    return connected && ws && ws.readyState === WebSocket.OPEN;
  }

  return { connect, relay, close, isConnected };
}
