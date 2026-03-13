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

    ws.addEventListener('message', (ev) => {
      const msg = safeJsonParse(String(ev.data));
      if (!msg || typeof msg !== 'object') return;

      // Forwarded messages are opaque: { from, payload }
      if (typeof msg.from === 'string' && 'payload' in msg) {
        onForward({ from: msg.from, payload: msg.payload });
      }
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

  return { connect, close, isConnected };
}
