import crypto from 'node:crypto';

function nowIso() {
  return new Date().toISOString();
}

function log(event, fields = {}) {
  // machine-safe JSONL
  process.stdout.write(`${JSON.stringify({ ok: true, event, ts: nowIso(), ...fields })}\n`);
}

function isLocalOnlyUrl(url) {
  try {
    const u = new URL(url);
    const h = String(u.hostname || '').trim();
    return h === '127.0.0.1' || h === 'localhost' || h === '::1';
  } catch {
    return false;
  }
}

// Process-global singleton state.
const g = globalThis;
if (!g.__A2A_RELAY_SINGLETON__) {
  g.__A2A_RELAY_SINGLETON__ = {
    initialized: false,
    node_id: null,
    allowLocalRelay: false,
    relayCandidates: [],
    connection_state: 'DISCONNECTED', // CONNECTING|CONNECTED|DISCONNECTED
    reconnect_backoff_ms: 500,
    reconnect_timer: null,
    activeWs: null,
    stopping: false,
    handlersByTopic: new Map(),
    connectLoopRunning: false
  };
}

const S = g.__A2A_RELAY_SINGLETON__;

function addHandler(topic, fn) {
  if (!S.handlersByTopic.has(topic)) S.handlersByTopic.set(topic, new Set());
  S.handlersByTopic.get(topic).add(fn);
  return () => {
    try { S.handlersByTopic.get(topic)?.delete(fn); } catch {}
  };
}

function dispatchDeliver({ node_id, from, to, message_id, topic, payload }) {
  const hs1 = S.handlersByTopic.get(topic);
  const hs2 = S.handlersByTopic.get('*');
  for (const hs of [hs1, hs2]) {
    if (!hs) continue;
    for (const fn of hs) {
      try { fn({ node_id, from, to, message_id, topic, payload }); } catch {}
    }
  }
}

function scheduleReconnect() {
  if (S.stopping) return;
  if (S.reconnect_timer) return;
  const delay = Math.max(0, Math.min(5000, S.reconnect_backoff_ms));
  log('RELAY_RECONNECT_SCHEDULED', { node_id: S.node_id, delay_ms: delay });
  S.reconnect_timer = setTimeout(() => {
    S.reconnect_timer = null;
    void ensureConnected();
  }, delay);
  S.reconnect_timer.unref();
  S.reconnect_backoff_ms = Math.min(5000, S.reconnect_backoff_ms * 2);
}

async function connectOnce({ relayUrl, index, attempt }) {
  if (!relayUrl) return { ok: false, error: { code: 'NO_RELAY_URL' } };
  if (!S.allowLocalRelay && isLocalOnlyUrl(relayUrl)) {
    log('RELAY_CONNECT_ATTEMPT', { node_id: S.node_id, relay_url: relayUrl, index, attempt, skipped: true, reason: 'LOCAL_RELAY_DISALLOWED' });
    return { ok: false, error: { code: 'LOCAL_RELAY_DISALLOWED' } };
  }

  if (S.connection_state === 'CONNECTING') {
    log('RELAY_CONNECT_SKIPPED_ALREADY_CONNECTING', { node_id: S.node_id, relay_url: relayUrl, index, attempt, state: S.connection_state });
    return { ok: false, error: { code: 'ALREADY_CONNECTING' } };
  }
  if (S.connection_state === 'CONNECTED') {
    log('RELAY_CONNECT_SKIPPED_ALREADY_CONNECTED', { node_id: S.node_id, relay_url: relayUrl, index, attempt, state: S.connection_state });
    return { ok: true, ws: S.activeWs };
  }

  // Hard guarantee: only one ws in-process.
  if (g.__RELAY_SINGLETON_WS__ && g.__RELAY_SINGLETON_WS__.readyState && g.__RELAY_SINGLETON_WS__.readyState !== 3) {
    log('RELAY_CONNECT_BLOCKED_DUPLICATE', { node_id: S.node_id, relay_url: relayUrl, state: S.connection_state });
    return { ok: false, error: { code: 'DUPLICATE_WS_BLOCKED' } };
  }

  S.connection_state = 'CONNECTING';
  log('RELAY_CONNECT_ATTEMPT', { node_id: S.node_id, relay_url: relayUrl, index, attempt, state: S.connection_state });

  return await new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };

    const ws = new WebSocket(relayUrl);
    g.__RELAY_SINGLETON_WS__ = ws;

    let registered = false;

    const timeout = setTimeout(() => {
      try { ws.close(); } catch {}
      S.connection_state = 'DISCONNECTED';
      try { if (g.__RELAY_SINGLETON_WS__ === ws) g.__RELAY_SINGLETON_WS__ = null; } catch {}
      finish({ ok: false, error: { code: 'REGISTER_TIMEOUT' } });
    }, 8000);
    timeout.unref();

    ws.onopen = () => {
      log('RELAY_CONNECT_OK', { node_id: S.node_id, relay_url: relayUrl });
      try { ws.send(JSON.stringify({ type: 'REGISTER', from: S.node_id })); } catch {}
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      try { ws.close(); } catch {}
      S.connection_state = 'DISCONNECTED';
      try { if (g.__RELAY_SINGLETON_WS__ === ws) g.__RELAY_SINGLETON_WS__ = null; } catch {}
      finish({ ok: false, error: { code: 'WS_ERROR' } });
    };

    ws.onmessage = (ev) => {
      let msg = null;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }

      if (msg?.type === 'REGISTER_ACK' && msg?.to === S.node_id && msg?.accepted === true) {
        clearTimeout(timeout);
        registered = true;
        S.connection_state = 'CONNECTED';
        S.reconnect_backoff_ms = 500;
        try { if (S.reconnect_timer) clearTimeout(S.reconnect_timer); } catch {}
        S.reconnect_timer = null;

        S.activeWs = ws;
        // v0.8.4: relay may include bounded peer hints in REGISTER_ACK (additive)
        try {
          const peers = Array.isArray(msg?.peers) ? msg.peers : [];
          log('RELAY_REGISTER_OK', { node_id: S.node_id, relay_url: relayUrl, peer_hint_count: peers.length });
          if (peers.length) {
            dispatchDeliver({
              node_id: S.node_id,
              from: 'relay',
              to: S.node_id,
              message_id: `relay_peer_hints:${Date.now()}`,
              topic: 'relay.peer_hints',
              payload: { peers, relay_url: relayUrl, ts: nowIso() }
            });
          }
        } catch {
          log('RELAY_REGISTER_OK', { node_id: S.node_id, relay_url: relayUrl });
        }

        // runtime receive loop
        ws.onmessage = (ev2) => {
          let m2 = null;
          try { m2 = JSON.parse(String(ev2.data)); } catch { return; }

          if (m2?.type === 'DELIVER') {
            const topic = m2?.data?.topic ?? null;
            const payload = m2?.data?.payload ?? null;

            log('RELAY_MESSAGE_RECEIVED', {
              node_id: S.node_id,
              from: m2?.from ?? null,
              to: m2?.to ?? null,
              message_id: m2?.message_id ?? null,
              topic
            });

            dispatchDeliver({
              node_id: S.node_id,
              from: m2?.from ?? null,
              to: m2?.to ?? null,
              message_id: m2?.message_id ?? null,
              topic,
              payload
            });
            return;
          }

          if (m2?.type === 'ERROR') {
            log('RELAY_MESSAGE_RECEIVED', { node_id: S.node_id, error: m2?.error ?? null, message_id: m2?.message_id ?? null });
          }
        };

        ws.onclose = () => {
          if (S.stopping) return;
          S.connection_state = 'DISCONNECTED';
          if (S.activeWs === ws) S.activeWs = null;
          try { if (g.__RELAY_SINGLETON_WS__ === ws) g.__RELAY_SINGLETON_WS__ = null; } catch {}
          log('RELAY_DISCONNECTED', { node_id: S.node_id, relay_url: relayUrl });
          scheduleReconnect();
        };

        finish({ ok: true, ws, relayUrl });
        return;
      }
    };

    ws.onclose = () => {
      if (registered) return;
      clearTimeout(timeout);
      S.connection_state = 'DISCONNECTED';
      try { if (g.__RELAY_SINGLETON_WS__ === ws) g.__RELAY_SINGLETON_WS__ = null; } catch {}
      finish({ ok: false, error: { code: 'CLOSED_BEFORE_REGISTER' } });
    };
  });
}

export async function ensureConnected() {
  if (S.connectLoopRunning) return;
  if (S.connection_state === 'CONNECTING') return;
  if (S.connection_state === 'CONNECTED') return;

  S.connectLoopRunning = true;
  try {
    const maxAttemptsPerRelay = Number(process.env.RELAY_RECONNECT_ATTEMPTS || 3);
    const ordered = Array.isArray(S.relayCandidates) ? S.relayCandidates : [];

    for (let idx = 0; idx < ordered.length; idx++) {
      const relayUrl = ordered[idx];
      for (let attempt = 1; attempt <= maxAttemptsPerRelay; attempt++) {
        if (S.stopping) return;
        const out = await connectOnce({ relayUrl, index: idx, attempt });
        if (out.ok && out.ws) return;
        await new Promise((r) => setTimeout(r, 300 * attempt));
      }
    }

    log('RELAY_ALL_CANDIDATES_FAILED', { node_id: S.node_id, relay_urls: ordered });
  } finally {
    S.connectLoopRunning = false;
    if (S.connection_state === 'CONNECTING') S.connection_state = 'DISCONNECTED';
  }
}

export function initRelaySingleton({ node_id, relayCandidates = [], allowLocalRelay = false } = {}) {
  if (!node_id) throw new Error('relaySingleton: missing node_id');

  if (!S.initialized) {
    S.initialized = true;
    S.node_id = node_id;
    S.relayCandidates = Array.isArray(relayCandidates) ? relayCandidates : [];
    S.allowLocalRelay = !!allowLocalRelay;
  } else {
    if (S.node_id !== node_id) throw new Error(`relaySingleton: node_id mismatch (have ${S.node_id}, got ${node_id})`);
  }

  return {
    subscribe: (topic, handler) => addHandler(String(topic || '*'), handler),
    ensureConnected,
    send: async ({ to, topic, payload, message_id } = {}) => {
      await ensureConnected();
      if (!S.activeWs || S.activeWs.readyState !== 1) {
        return { ok: false, error: { code: 'NOT_CONNECTED' } };
      }
      const m = {
        type: 'SEND',
        from: S.node_id,
        to,
        message_id: typeof message_id === 'string' && message_id.trim() ? message_id.trim() : `msg:${crypto.randomUUID()}`,
        data: { topic, payload }
      };
      try {
        S.activeWs.send(JSON.stringify(m));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: { code: 'SEND_FAILED', reason: String(e?.message || 'send_failed') } };
      }
    },
    close: async () => {
      S.stopping = true;
      try { if (S.reconnect_timer) clearTimeout(S.reconnect_timer); } catch {}
      S.reconnect_timer = null;
      try { if (S.activeWs) S.activeWs.close(); } catch {}
      S.activeWs = null;
      S.connection_state = 'DISCONNECTED';
      try { g.__RELAY_SINGLETON_WS__ = null; } catch {}
    }
  };
}

// Test-only escape hatch: reset process-global singleton to avoid cross-test contamination.
export function __resetRelaySingletonForTests() {
  try {
    S.stopping = true;
    if (S.reconnect_timer) clearTimeout(S.reconnect_timer);
  } catch {}
  try { if (S.activeWs) S.activeWs.close(); } catch {}
  try { if (g.__RELAY_SINGLETON_WS__) g.__RELAY_SINGLETON_WS__.close(); } catch {}

  S.initialized = false;
  S.node_id = null;
  S.allowLocalRelay = false;
  S.relayCandidates = [];
  S.connection_state = 'DISCONNECTED';
  S.reconnect_backoff_ms = 500;
  S.reconnect_timer = null;
  S.activeWs = null;
  S.stopping = false;
  S.handlersByTopic = new Map();
  S.connectLoopRunning = false;

  try { g.__RELAY_SINGLETON_WS__ = null; } catch {}
}
