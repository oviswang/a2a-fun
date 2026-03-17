import { createFetchHttpClient } from '../bootstrap/bootstrapClient.mjs';

function nowIso() {
  return new Date().toISOString();
}

function log(event, fields = {}) {
  // machine-safe JSONL
  console.log(JSON.stringify({ ok: true, event, ts: nowIso(), ...fields }));
}

function isLocalhostHostname(h) {
  const s = String(h || '').toLowerCase();
  return s === 'localhost' || s === '127.0.0.1' || s === '0.0.0.0' || s === '::1';
}

function isLocalOnlyUrl(url) {
  try {
    const u = new URL(url);
    return isLocalhostHostname(u.hostname);
  } catch {
    return true;
  }
}

function dedupPreserveOrder(list) {
  const out = [];
  const seen = new Set();
  for (const it of list) {
    const s = String(it || '').trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

async function postJson(httpClient, url, body) {
  const r = await httpClient(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, ok: r.ok, json: j };
}

async function getJson(httpClient, url) {
  const r = await httpClient(url, { method: 'GET' });
  const j = await r.json().catch(() => null);
  return { status: r.status, ok: r.ok, json: j };
}

export async function startNodeNetworkIntegrationV0_1({
  node_id,
  version,
  capabilities,
  relay_urls = [],
  observed_addrs = [],
  bootstrap_base_url,
  relay_url_override = null,
  onDeliver = null,
  heartbeatEveryMs = 45_000,
  httpTimeoutMs = 5_000
} = {}) {
  if (!node_id) throw new Error('NodeNetworkIntegration: node_id required');
  if (!bootstrap_base_url) throw new Error('NodeNetworkIntegration: bootstrap_base_url required');

  const base = String(bootstrap_base_url).replace(/\/$/, '');
  const httpClient = createFetchHttpClient({ timeoutMs: httpTimeoutMs });

  // 1) publish-self
  {
    const out = await postJson(httpClient, `${base}/publish-self`, {
      node_id,
      version: version || null,
      capabilities: capabilities || {},
      relay_urls: Array.isArray(relay_urls) ? relay_urls : [],
      observed_addrs: Array.isArray(observed_addrs) ? observed_addrs : [],
      ts: nowIso()
    }).catch((e) => ({ status: 0, ok: false, json: { ok: false, error: { code: 'FETCH_FAIL', reason: e.message } } }));

    if (out.ok && out.json?.ok === true) {
      log('BOOTSTRAP_PUBLISH_OK', { node_id });
    } else {
      log('BOOTSTRAP_PUBLISH_OK', { node_id, warning: 'publish_failed', status: out.status, error: out.json?.error || null });
    }
  }

  // 2) heartbeat loop (best-effort)
  let hbTimer = null;
  const heartbeat = async () => {
    const out = await postJson(httpClient, `${base}/heartbeat`, { node_id, ts: nowIso() }).catch((e) => ({
      status: 0,
      ok: false,
      json: { ok: false, error: { code: 'FETCH_FAIL', reason: e.message } }
    }));

    if (out.ok && out.json?.ok === true) {
      log('BOOTSTRAP_HEARTBEAT_OK', { node_id });
    } else {
      log('BOOTSTRAP_HEARTBEAT_OK', { node_id, warning: 'heartbeat_failed', status: out.status, error: out.json?.error || null });
    }
  };

  hbTimer = setInterval(heartbeat, heartbeatEveryMs);
  hbTimer.unref();

  // 3) build relay candidate list
  const candidates = [];
  if (relay_url_override) candidates.push(String(relay_url_override).trim());

  try {
    const r = await getJson(httpClient, `${base}/relays`).catch(() => null);
    if (r && r.ok && r.json?.ok === true && Array.isArray(r.json?.relays)) {
      for (const u of r.json.relays) candidates.push(u);
    }
  } catch {}

  // include any relay_urls passed in publish-self (lowest priority)
  if (Array.isArray(relay_urls)) {
    for (const u of relay_urls) candidates.push(u);
  }

  const relayCandidates = dedupPreserveOrder(candidates);
  log('RELAY_CANDIDATES_READY', { node_id, relay_urls: relayCandidates });

  const allowLocalRelay = String(process.env.ALLOW_LOCAL_RELAY || '') === '1';

  const state = {
    ok: true,
    node_id,
    bootstrap_base_url: base,
    relay_url: null,
    relay_candidates: relayCandidates,
    relay_connected: false,
    relay_registered: false,
    last_message_at: null
  };

  let activeWs = null;
  let stopping = false;

  const send = ({ to, topic, payload, message_id = null } = {}) => {
    if (!state.relay_registered || !activeWs) return { ok: false, error: { code: 'RELAY_NOT_REGISTERED' } };
    const m = {
      type: 'SEND',
      from: node_id,
      to,
      message_id: message_id || undefined,
      data: { topic, payload }
    };
    try {
      activeWs.send(JSON.stringify(m));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: { code: 'SEND_FAILED', reason: String(e?.message || 'send_failed') } };
    }
  };

  const connectOnce = async ({ relayUrl, index, attempt }) => {
    if (!relayUrl) return { ok: false, error: { code: 'NO_RELAY_URL' } };
    if (!allowLocalRelay && isLocalOnlyUrl(relayUrl)) {
      log('RELAY_CONNECT_ATTEMPT', { node_id, relay_url: relayUrl, index, attempt, skipped: true, reason: 'LOCAL_RELAY_DISALLOWED' });
      return { ok: false, error: { code: 'LOCAL_RELAY_DISALLOWED' } };
    }

    log('RELAY_CONNECT_ATTEMPT', { node_id, relay_url: relayUrl, index, attempt });

    return await new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        resolve(v);
      };

      const ws = new WebSocket(relayUrl);
      let registered = false;

      const timeout = setTimeout(() => {
        try { ws.close(); } catch {}
        finish({ ok: false, error: { code: 'REGISTER_TIMEOUT' } });
      }, 8000);
      timeout.unref();

      ws.onopen = () => {
        state.relay_connected = true;
        log('RELAY_CONNECT_OK', { node_id, relay_url: relayUrl });
        ws.send(JSON.stringify({ type: 'REGISTER', from: node_id }));
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        try { ws.close(); } catch {}
        finish({ ok: false, error: { code: 'WS_ERROR' } });
      };

      ws.onmessage = (ev) => {
        let msg = null;
        try { msg = JSON.parse(String(ev.data)); } catch { return; }
        state.last_message_at = nowIso();

        if (msg?.type === 'REGISTER_ACK' && msg?.to === node_id && msg?.accepted === true) {
          clearTimeout(timeout);
          registered = true;
          state.relay_registered = true;
          state.relay_url = relayUrl;
          log('RELAY_REGISTER_OK', { node_id, relay_url: relayUrl });

          // attach handlers for runtime receive loop
          ws.onmessage = (ev2) => {
            let m2 = null;
            try { m2 = JSON.parse(String(ev2.data)); } catch { return; }
            state.last_message_at = nowIso();

            if (m2?.type === 'DELIVER') {
              log('RELAY_MESSAGE_RECEIVED', {
                node_id,
                from: m2?.from ?? null,
                to: m2?.to ?? null,
                message_id: m2?.message_id ?? null,
                topic: m2?.data?.topic ?? null
              });
              try {
                if (typeof onDeliver === 'function') {
                  onDeliver({
                    node_id,
                    from: m2?.from ?? null,
                    to: m2?.to ?? null,
                    message_id: m2?.message_id ?? null,
                    topic: m2?.data?.topic ?? null,
                    payload: m2?.data?.payload ?? null
                  });
                }
              } catch {}
              return;
            }

            if (m2?.type === 'ERROR') {
              log('RELAY_MESSAGE_RECEIVED', { node_id, error: m2?.error ?? null, message_id: m2?.message_id ?? null });
            }
          };

          ws.onclose = () => {
            if (stopping) return;
            state.relay_connected = false;
            state.relay_registered = false;
            log('RELAY_DISCONNECTED', { node_id, relay_url: relayUrl });
            // trigger background reconnection
            void ensureConnected();
          };

          finish({ ok: true, ws });
          return;
        }
      };

      ws.onclose = () => {
        if (registered) return;
        clearTimeout(timeout);
        finish({ ok: false, error: { code: 'CLOSED_BEFORE_REGISTER' } });
      };
    });
  };

  let reconnecting = false;

  const ensureConnected = async () => {
    if (reconnecting) return;
    reconnecting = true;

    try {
      // Try current relay a few times first, then failover.
      const maxAttemptsPerRelay = Number(process.env.RELAY_RECONNECT_ATTEMPTS || 3);

      const startIndex = state.relay_url ? Math.max(0, relayCandidates.indexOf(state.relay_url)) : 0;
      const ordered = relayCandidates.length ? relayCandidates : [];

      for (let offset = 0; offset < ordered.length; offset++) {
        const idx = (startIndex + offset) % ordered.length;
        const relayUrl = ordered[idx];

        if (offset > 0) {
          log('RELAY_FAILOVER_NEXT', { node_id, relay_url: relayUrl, index: idx });
        }

        for (let attempt = 1; attempt <= maxAttemptsPerRelay; attempt++) {
          if (stopping) return;

          const out = await connectOnce({ relayUrl, index: idx, attempt });
          if (out.ok && out.ws) {
            // replace active ws
            try { if (activeWs && activeWs !== out.ws) activeWs.close(); } catch {}
            activeWs = out.ws;
            return;
          }

          // brief deterministic backoff
          await new Promise((r) => setTimeout(r, 300 * attempt));
        }
      }

      log('RELAY_ALL_CANDIDATES_FAILED', { node_id, relay_urls: relayCandidates });
    } finally {
      reconnecting = false;
    }
  };

  // initial connection attempt (non-fatal)
  await ensureConnected();

  return {
    ok: !!(state.relay_connected && state.relay_registered),
    state,
    send,
    close: async () => {
      stopping = true;
      try { if (hbTimer) clearInterval(hbTimer); } catch {}
      try { if (activeWs) activeWs.close(); } catch {}
      activeWs = null;
    }
  };
}
