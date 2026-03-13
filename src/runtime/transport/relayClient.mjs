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
export function createRelayClient({ relayUrl, nodeId, onForward, onDisconnect } = {}) {
  if (!relayUrl) throw new Error('relayClient: missing relayUrl');
  if (!nodeId) throw new Error('relayClient: missing nodeId');
  if (typeof onForward !== 'function') throw new Error('relayClient: missing onForward');

  let ws = null;
  let connected = false;

  async function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    ws = new WebSocket(relayUrl);

    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    connected = true;

    let didRegister = false;
    const registeredPromise = new Promise((resolve) => {
      ws.addEventListener(
        'message',
        (ev) => {
          const msg = safeJsonParse(String(ev.data));
          if (!msg || typeof msg !== 'object') return;

          // Registration ack.
          if (msg.ok === true && msg.type === 'registered' && msg.node === nodeId) {
            didRegister = true;
            resolve(true);
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

    // Register.
    ws.send(JSON.stringify({ type: 'register', node: nodeId }));

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
