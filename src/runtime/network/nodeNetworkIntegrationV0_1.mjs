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

  // 2) heartbeat loop (best-effort; do not crash runtime)
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
      // still emit required event, but mark as warning
      log('BOOTSTRAP_HEARTBEAT_OK', { node_id, warning: 'heartbeat_failed', status: out.status, error: out.json?.error || null });
    }
  };

  hbTimer = setInterval(heartbeat, heartbeatEveryMs);
  hbTimer.unref();

  // 3) fetch relay list
  let relayUrl = relay_url_override ? String(relay_url_override).trim() : '';
  if (!relayUrl) {
    const r = await getJson(httpClient, `${base}/relays`).catch(() => null);
    if (r && r.ok && r.json?.ok === true && Array.isArray(r.json?.relays) && r.json.relays.length > 0) {
      relayUrl = String(r.json.relays[0] || '').trim();
    }
  }

  // 4) connect to relay (must not connect to localhost unless explicitly configured)
  const allowLocalRelay = String(process.env.ALLOW_LOCAL_RELAY || '') === '1';
  if (!relayUrl) {
    log('RELAY_CONNECT_OK', { node_id, accepted: false, error: 'NO_RELAY_URL' });
    return { ok: false, error: { code: 'NO_RELAY_URL' } };
  }

  if (!allowLocalRelay && isLocalOnlyUrl(relayUrl)) {
    log('RELAY_CONNECT_OK', { node_id, accepted: false, error: 'LOCAL_RELAY_DISALLOWED', relay_url: relayUrl });
    return { ok: false, error: { code: 'LOCAL_RELAY_DISALLOWED' } };
  }

  const ws = new WebSocket(relayUrl);

  const state = {
    ok: true,
    node_id,
    bootstrap_base_url: base,
    relay_url: relayUrl,
    relay_connected: false,
    relay_registered: false,
    last_message_at: null
  };

  const readyP = new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };

    ws.onopen = () => {
      state.relay_connected = true;
      log('RELAY_CONNECT_OK', { node_id, relay_url: relayUrl });
      // 5) register
      ws.send(JSON.stringify({ type: 'REGISTER', from: node_id }));
    };

    ws.onerror = () => {
      if (!state.relay_connected) {
        log('RELAY_CONNECT_OK', { node_id, accepted: false, relay_url: relayUrl, error: 'WS_ERROR' });
      }
      finish(false);
    };

    ws.onmessage = (ev) => {
      let msg = null;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }

      state.last_message_at = nowIso();

      if (msg?.type === 'REGISTER_ACK' && msg?.to === node_id && msg?.accepted === true) {
        state.relay_registered = true;
        log('RELAY_REGISTER_OK', { node_id, relay_url: relayUrl });
        finish(true);
        return;
      }

      // Any delivered message must be observable.
      if (msg?.type === 'DELIVER') {
        log('RELAY_MESSAGE_RECEIVED', {
          node_id,
          from: msg?.from ?? null,
          to: msg?.to ?? null,
          message_id: msg?.message_id ?? null,
          topic: msg?.data?.topic ?? null
        });
        return;
      }

      // Also log errors as received messages (helps observability).
      if (msg?.type === 'ERROR') {
        log('RELAY_MESSAGE_RECEIVED', { node_id, error: msg?.error ?? null, message_id: msg?.message_id ?? null });
        return;
      }
    };

    ws.onclose = () => {
      state.relay_connected = false;
      finish(false);
    };

    // registration should complete quickly
    setTimeout(() => finish(false), 8000).unref();
  });

  // Wait until either REGISTER_ACK arrives or timeout.
  await readyP;

  return {
    ok: state.relay_connected && state.relay_registered,
    state,
    close: async () => {
      try {
        if (hbTimer) clearInterval(hbTimer);
      } catch {}
      try {
        ws.close();
      } catch {}
    }
  };
}
