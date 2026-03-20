import { createFetchHttpClient } from '../bootstrap/bootstrapClient.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getNetworkSnapshot } from './networkSnapshotV0_1.mjs';

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

function workspacePath() {
  return String(process.env.A2A_WORKSPACE_PATH || process.cwd());
}

async function readJsonFileSafe(p) {
  try {
    const s = await fs.readFile(p, 'utf-8');
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function writeJsonAtomic(p, obj) {
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf-8');
  await fs.rename(tmp, p);
}

function normalizePeer(p) {
  if (!p) return null;
  const node_id = String(p.node_id || '').trim();
  if (!node_id) return null;
  const relay_urls = Array.isArray(p.relay_urls) ? dedupPreserveOrder(p.relay_urls) : [];
  const capabilities = p.capabilities && typeof p.capabilities === 'object' ? p.capabilities : {};
  const last_seen = p.last_seen ? String(p.last_seen) : null;
  return { node_id, relay_urls, capabilities, last_seen };
}

function mergePeersByNodeId({ existing = [], incoming = [], selfNodeId = null } = {}) {
  const map = new Map();

  for (const p of existing) {
    const n = normalizePeer(p);
    if (!n) continue;
    if (selfNodeId && n.node_id === selfNodeId) continue;
    map.set(n.node_id, n);
  }

  let added = 0;
  let updated = 0;

  for (const p of incoming) {
    const n = normalizePeer(p);
    if (!n) continue;
    if (selfNodeId && n.node_id === selfNodeId) continue;

    const prev = map.get(n.node_id);
    if (!prev) {
      map.set(n.node_id, n);
      added++;
      continue;
    }

    const merged = {
      node_id: prev.node_id,
      relay_urls: dedupPreserveOrder([...(prev.relay_urls || []), ...(n.relay_urls || [])]),
      capabilities: { ...(prev.capabilities || {}), ...(n.capabilities || {}) },
      last_seen: n.last_seen || prev.last_seen || null
    };

    map.set(n.node_id, merged);
    updated++;
  }

  return { peers: Array.from(map.values()), added, updated };
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
      agent_id: (process.env.AGENT_ID || null),
      public_key: (process.env.AGENT_PUBLIC_KEY || null),
      signature: (process.env.AGENT_SIGNATURE || null),
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
  // P2P note:
  // - Relay keepalive proves connection liveness (WebSocket).
  // - Heartbeat/publish-self prove *directory visibility* (compatibility layer).
  // - Future: gossip-based presence can coexist; bootstrap is not the source of truth.
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

  // 2b) presence refresh loop (node-driven, directory visibility)
  // Fixes: relay connected/registered while bootstrap last_seen stalls.
  // This is *not* centralized polling: each node autonomously republishes itself periodically.
  const presenceEveryMs = Number(process.env.PRESENCE_REFRESH_EVERY_MS || 30_000);
  let presenceTimer = null;

  const presenceRefreshOnce = async ({ reason = 'periodic' } = {}) => {
    log('PRESENCE_REFRESH_ATTEMPT', { node_id, ts: nowIso(), mode: 'daemon', reason, every_ms: presenceEveryMs });

    const out = await postJson(httpClient, `${base}/publish-self`, {
      node_id,
      agent_id: (process.env.AGENT_ID || null),
      public_key: (process.env.AGENT_PUBLIC_KEY || null),
      signature: (process.env.AGENT_SIGNATURE || null),
      version: version || null,
      capabilities: capabilities || {},
      relay_urls: Array.isArray(relay_urls) ? relay_urls : [],
      observed_addrs: Array.isArray(observed_addrs) ? observed_addrs : [],
      ts: nowIso()
    }).catch((e) => ({ status: 0, ok: false, json: { ok: false, error: { code: 'FETCH_FAIL', reason: e.message } } }));

    if (out.ok && out.json?.ok === true) {
      log('PRESENCE_REFRESH_OK', { node_id, ts: nowIso() });
    } else {
      log('PRESENCE_REFRESH_FAILED', { node_id, ts: nowIso(), status: out.status, error: out.json?.error || null });
    }
  };

  if (Number.isFinite(presenceEveryMs) && presenceEveryMs > 0) {
    presenceTimer = setInterval(() => {
      try {
        void presenceRefreshOnce({ reason: 'periodic' });
      } catch {}
    }, presenceEveryMs);
    presenceTimer.unref();

    // Kick once soon after startup so fresh installs see liveness quickly.
    setTimeout(() => {
      try {
        void presenceRefreshOnce({ reason: 'startup' });
      } catch {}
    }, 500).unref?.();
  }

  // 3) bootstrap discovery (relays + peers) with degraded-mode cache
  const ws = workspacePath();
  const relayCachePath = path.join(ws, 'data', 'relay-cache.json');
  const peerCachePath = path.join(ws, 'data', 'peer-cache.json');

  const candidates = [];
  if (relay_url_override) candidates.push(String(relay_url_override).trim());

  let bootstrapRelays = null;
  let bootstrapPeers = null;

  // Try bootstrap first (preferred)
  try {
    const r = await getJson(httpClient, `${base}/relays`).catch(() => null);
    if (r && r.ok && r.json?.ok === true && Array.isArray(r.json?.relays)) {
      bootstrapRelays = r.json.relays;
      for (const u of bootstrapRelays) candidates.push(u);
      await writeJsonAtomic(relayCachePath, { ok: true, protocol: 'a2a/0.1', updated_at: nowIso(), relays: dedupPreserveOrder(bootstrapRelays) });
      log('BOOTSTRAP_CACHE_UPDATED', { node_id, kind: 'relays', count: dedupPreserveOrder(bootstrapRelays).length });
    }
  } catch {}

  try {
    const p = await getJson(httpClient, `${base}/peers`).catch(() => null);
    if (p && p.ok && p.json?.ok === true && Array.isArray(p.json?.peers)) {
      bootstrapPeers = p.json.peers;
    }
  } catch {}

  const bootstrapOk = Array.isArray(bootstrapRelays) || Array.isArray(bootstrapPeers);

  // Load existing peer cache (if any) and merge bootstrap peers into it.
  let knownPeers = [];
  {
    const peerCache = await readJsonFileSafe(peerCachePath);
    const cachedPeers = Array.isArray(peerCache?.peers) ? peerCache.peers : [];

    const merged = mergePeersByNodeId({ existing: cachedPeers, incoming: Array.isArray(bootstrapPeers) ? bootstrapPeers : [], selfNodeId: node_id });
    knownPeers = merged.peers;

    // Persist merged peers if bootstrap provided peers, or if cache existed but had invalid shape.
    if (Array.isArray(bootstrapPeers)) {
      await writeJsonAtomic(peerCachePath, { ok: true, protocol: 'a2a/0.1', updated_at: nowIso(), peers: knownPeers });
      log('BOOTSTRAP_CACHE_UPDATED', { node_id, kind: 'peers', count: knownPeers.length });
    }
  }

  // If bootstrap unavailable, use cache
  if (!bootstrapOk) {
    const relayCache = await readJsonFileSafe(relayCachePath);
    const cachedRelays = Array.isArray(relayCache?.relays) ? relayCache.relays : null;
    if (cachedRelays && cachedRelays.length) {
      log('BOOTSTRAP_UNAVAILABLE_USING_CACHE', { node_id, kind: 'relays', count: cachedRelays.length });
      log('RELAY_CACHE_LOADED', { node_id, relay_urls: cachedRelays });
      for (const u of cachedRelays) candidates.push(u);
    } else {
      log('BOOTSTRAP_UNAVAILABLE_NO_CACHE', { node_id, kind: 'relays' });
    }

    if (knownPeers && knownPeers.length) {
      log('PEER_CACHE_LOADED', { node_id, count: knownPeers.length });
    }
  }

  // include any relay_urls passed in publish-self (lowest priority)
  if (Array.isArray(relay_urls)) {
    for (const u of relay_urls) candidates.push(u);
  }

  // Minimal safety fallback: if bootstrap+cache provided no relays, use an explicit fallback.
  if (candidates.length === 0) {
    const raw = String(process.env.RELAY_FALLBACK_URLS || 'wss://gw.bothook.me/relay');
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    for (const u of parts) candidates.push(u);
    log('RELAY_CANDIDATES_FALLBACK_USED', { node_id, relay_urls: parts });
  }

  const relayCandidates = dedupPreserveOrder(candidates);
  log('RELAY_CANDIDATES_READY', { node_id, relay_urls: relayCandidates });

  const allowLocalRelay = String(process.env.ALLOW_LOCAL_RELAY || '') === '1';

  // WebSocket implementation
  // Prefer `ws` package for consistency across Node runtimes.
  let WebSocketCtor = null;
  try {
    const w = await import('ws');
    WebSocketCtor = w.WebSocket;
  } catch {
    WebSocketCtor = globalThis.WebSocket || null;
  }
  if (!WebSocketCtor) {
    log('RELAY_WEBSOCKET_UNAVAILABLE', { node_id });
  }

  const state = {
    ok: true,
    node_id,
    bootstrap_base_url: base,
    relay_url: null,
    relay_candidates: relayCandidates,
    relay_connected: false,
    relay_registered: false,
    last_message_at: null,
    known_peers: knownPeers,
    peer_cache_path: peerCachePath
  };

  let activeWs = null;
  let stopping = false;

  const send = ({ to, topic, payload, message_id = null } = {}) => {
    const wsState = activeWs && typeof activeWs.readyState === 'number' ? activeWs.readyState : null;

    log('RELAY_SEND_ATTEMPT', { node_id, to: to || null, topic: topic || null, message_id: message_id || null, relay_registered: !!state.relay_registered, ws_ready_state: wsState });

    if (!state.relay_registered || !activeWs) {
      log('RELAY_SEND_FAILED', { node_id, to: to || null, topic: topic || null, message_id: message_id || null, error: { code: 'RELAY_NOT_REGISTERED' } });
      return { ok: false, error: { code: 'RELAY_NOT_REGISTERED' } };
    }

    // ws: OPEN = 1
    if (typeof activeWs.readyState === 'number' && activeWs.readyState !== 1) {
      log('RELAY_SEND_FAILED', { node_id, to: to || null, topic: topic || null, message_id: message_id || null, error: { code: 'WS_NOT_OPEN', ready_state: activeWs.readyState } });
      return { ok: false, error: { code: 'WS_NOT_OPEN', ready_state: activeWs.readyState } };
    }

    const m = {
      type: 'SEND',
      from: node_id,
      to,
      message_id: message_id || undefined,
      data: { topic, payload }
    };
    try {
      activeWs.send(JSON.stringify(m));
      log('RELAY_SEND_RESULT', { node_id, to: to || null, topic: topic || null, message_id: message_id || null, ok_send: true });
      return { ok: true };
    } catch (e) {
      log('RELAY_SEND_RESULT', { node_id, to: to || null, topic: topic || null, message_id: message_id || null, ok_send: false, error: { code: 'SEND_FAILED', reason: String(e?.message || 'send_failed') } });
      return { ok: false, error: { code: 'SEND_FAILED', reason: String(e?.message || 'send_failed') } };
    }
  };

  // Peer gossip (supplemental discovery)
  let gossipTimer = null;
  const gossipEveryMs = Number(process.env.PEER_GOSSIP_EVERY_MS || 90_000);

  // Presence gossip (P2P-native liveness; bootstrap is compatibility only)
  // - Relay keepalive: proves connection liveness.
  // - Presence gossip: propagates liveness node-to-node.
  // - Bootstrap visibility: optional directory, not the source of truth.
  const presenceGossipEveryMs = Number(process.env.PRESENCE_GOSSIP_EVERY_MS || 30_000);
  const presenceActiveWindowMs = Number(process.env.PRESENCE_ACTIVE_WINDOW_MS || 120_000);
  const presenceCachePath = path.join(workspacePath(), 'data', 'presence-cache.json');
  let presenceGossipTimer = null;
  let presenceCache = { ok: true, protocol: 'a2a/0.1', updated_at: null, peers: {} };
  let networkHealthClass = null; // HEALTHY|MIXED|DEGRADED (best-effort, log-only)

  try {
    const loaded = await readJsonFileSafe(presenceCachePath);
    if (loaded && typeof loaded === 'object' && loaded.peers && typeof loaded.peers === 'object') presenceCache = loaded;
  } catch {}

  // First contact (P2P acknowledgment): join announce + welcome signals
  const welcomePath = path.join(workspacePath(), 'data', 'welcome-signals.json');
  let welcomeState = { ok: true, version: 'welcome.v0.1', updated_at: null, welcomes: [] };
  try {
    const loaded = await readJsonFileSafe(welcomePath);
    if (loaded && typeof loaded === 'object' && Array.isArray(loaded.welcomes)) welcomeState = loaded;
  } catch {}

  const saveWelcomeState = () => {
    welcomeState.updated_at = nowIso();
    void writeJsonAtomic(welcomePath, welcomeState).catch(() => {});
  };

  const recordWelcomeReceived = ({ from, ts }) => {
    if (!from || from === node_id) return;
    const item = { from, ts: ts || nowIso(), received_at: nowIso() };
    const arr = Array.isArray(welcomeState.welcomes) ? welcomeState.welcomes : [];
    arr.unshift(item);
    // keep last 5
    welcomeState.welcomes = arr.slice(0, 5);
    saveWelcomeState();
  };

  const welcomeSentTo = new Map(); // node_id -> last_sent_ms
  const shouldSendWelcome = (peer_id) => {
    const last = welcomeSentTo.get(peer_id) || 0;
    if (Date.now() - last < 10 * 60_000) return false; // 10 min cooldown per peer

    // OR: first N responders only (local approximation): always welcome the first time we see this peer.
    const firstN = Number(process.env.JOIN_WELCOME_FIRST_N || 1);
    if (firstN > 0 && !welcomeSentTo.has(peer_id)) return true;

    // Otherwise: randomized response to avoid spam.
    const p = String(process.env.JOIN_WELCOME_PROB || '0.3');
    const prob = Math.max(0, Math.min(1, Number(p)));
    return Math.random() < prob;
  };

  const sendJoinAnnounceOnce = () => {
    const payload = {
      node_id,
      ts: nowIso(),
      version: String(version || '').trim() || undefined,
      country_code: String(process.env.COUNTRY_CODE || '').trim().toUpperCase() || undefined
    };
    const targets = (state.known_peers || []).map((p) => p?.node_id).filter((x) => x && x !== node_id);
    const dedup = dedupPreserveOrder(targets);
    const ordered = trustAwareOrder(dedup, { reason: 'node.join.announce' });

    let okCount = 0;
    for (const to of ordered) {
      const out = send({ to, topic: 'node.join.announce', payload });
      if (out.ok) okCount++;
    }

    log('JOIN_ANNOUNCE_SENT', { node_id, peer_count: ordered.length, ok_count: okCount, ts: payload.ts });
  };
  const trustScoreFromState = (s) => {
    if (s === 'VERIFIED') return 2;
    if (s === 'UNVERIFIED' || !s) return 1;
    if (s === 'INVALID') return 0;
    if (s === 'QUARANTINED') return -1;
    return 1;
  };

  const trustStateOf = (peer_id) => {
    const p = presenceCache?.peers?.[peer_id] && typeof presenceCache.peers[peer_id] === 'object' ? presenceCache.peers[peer_id] : null;
    return p?.trust_state || p?.trust_level || 'UNVERIFIED';
  };

  const trustAwareOrder = (targets = [], { reason = 'generic' } = {}) => {
    const arr = Array.isArray(targets) ? targets.filter(Boolean) : [];

    const verified = [];
    const unverified = [];
    const invalid = [];
    const quarantined = [];

    for (const id of arr) {
      const s = trustStateOf(id);
      if (s === 'VERIFIED') verified.push(id);
      else if (s === 'QUARANTINED') quarantined.push(id);
      else if (s === 'INVALID') invalid.push(id);
      else unverified.push(id);
    }

    const ordered = [...verified, ...unverified, ...invalid, ...quarantined];

    // Hardening: INVALID/QUARANTINED are only used if no better peers exist.
    const hasBetter = verified.length + unverified.length > 0;
    const filtered_invalid = hasBetter ? invalid.length + quarantined.length : 0;
    const orderedFiltered = hasBetter ? [...verified, ...unverified] : ordered;

    log('TRUST_FILTER_APPLIED', {
      node_id,
      reason,
      verified: verified.length,
      unverified: unverified.length,
      invalid: invalid.length,
      quarantined: quarantined.length,
      filtered_invalid
    });

    log('TRUST_AWARE_SELECTION_APPLIED', {
      node_id,
      reason,
      verified_count: verified.length,
      unverified_count: unverified.length,
      invalid_count: invalid.length,
      quarantined_count: quarantined.length
    });
    log('TRUST_AWARE_SELECTION_RESULT', { node_id, reason, chosen_peer_order: orderedFiltered.slice(0, 50) });

    return orderedFiltered;
  };

  const buildGossipPeers = () => {
    const selfPeer = {
      node_id,
      relay_urls: state.relay_url ? [state.relay_url] : [],
      capabilities: capabilities || {},
      last_seen: nowIso()
    };
    const merged = mergePeersByNodeId({ existing: [selfPeer, ...(state.known_peers || [])], incoming: [], selfNodeId: null });
    return merged.peers;
  };

  const sendPeerGossipOnce = (reason = 'periodic') => {
    const peersPayload = buildGossipPeers();
    const targets = (state.known_peers || []).map((p) => p?.node_id).filter((x) => x && x !== node_id);

    const ordered = trustAwareOrder(dedupPreserveOrder(targets), { reason: `peer.gossip:${reason}` });

    for (const to of ordered) {
      const out = send({ to, topic: 'peer.gossip', payload: { peers: peersPayload } });
      log('PEER_GOSSIP_SENT', { node_id, to, peer_count: peersPayload.length, reason, ok: out.ok });
    }
  };

  const startGossipLoop = () => {
    if (gossipTimer) return;
    gossipTimer = setInterval(() => {
      try {
        if (state.relay_registered) sendPeerGossipOnce('periodic');
      } catch {}
    }, gossipEveryMs);
    gossipTimer.unref();
  };

  const buildPresencePayload = () => {
    const p = {
      node_id,
      ts: nowIso(),
      relay_urls: state.relay_url ? [state.relay_url] : (Array.isArray(relay_urls) ? relay_urls : []),
      capabilities: capabilities || {}
    };
    const ver = String(version || '').trim();
    if (ver) p.version = ver;
    if (ver) p.node_version = ver;
    const up = String(process.env.A2A_UPGRADE_STATE || '').trim();
    if (up) p.upgrade_state = up;
    const cc = String(process.env.COUNTRY_CODE || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(cc)) p.country_code = cc;
    const ag = String(process.env.AGENT_ID || '').trim();
    if (ag) p.agent_id = ag;
    const pk = String(process.env.AGENT_PUBLIC_KEY || '').trim();
    const sig = String(process.env.AGENT_SIGNATURE || '').trim();
    if (pk) p.public_key = pk;
    if (sig) p.signature = sig;

    // Optional advertised safe task types (bounded, hint-only)
    p.supported_task_types = ['echo', 'runtime_status', 'network_snapshot', 'trust_summary', 'presence_status', 'capability_summary'];

    return p;
  };

  const mergePresenceIntoCache = async ({ peer_id, payload }) => {
    if (!peer_id || peer_id === node_id) return;

    const ts = String(payload?.ts || '').trim();
    const tsMs = Date.parse(ts);
    const seenIso = Number.isFinite(tsMs) ? new Date(tsMs).toISOString() : nowIso();

    const relayUrls = Array.isArray(payload?.relay_urls) ? payload.relay_urls.filter((u) => typeof u === 'string' && u.trim()).slice(0, 6) : [];
    const caps = payload?.capabilities && typeof payload.capabilities === 'object' ? payload.capabilities : {};
    const supportedTaskTypes = Array.isArray(payload?.supported_task_types)
      ? payload.supported_task_types.filter((x) => typeof x === 'string' && x.trim()).map((x) => String(x).trim()).slice(0, 8)
      : null;

    const prev = presenceCache.peers?.[peer_id] && typeof presenceCache.peers[peer_id] === 'object' ? presenceCache.peers[peer_id] : {};

    const next = {
      peer_id,
      last_presence_ts: seenIso,
      relay_urls: relayUrls.length ? relayUrls : (Array.isArray(prev.relay_urls) ? prev.relay_urls : []),
      capabilities: Object.keys(caps).length ? caps : (prev.capabilities || {}),
      country_code: payload?.country_code || prev.country_code || null,
      version: payload?.version || prev.version || null,
      node_version: payload?.node_version || prev.node_version || payload?.version || prev.version || null,
      upgrade_state: payload?.upgrade_state || prev.upgrade_state || null,
      agent_id: payload?.agent_id || prev.agent_id || null,
      public_key: payload?.public_key || prev.public_key || null,
      signature: payload?.signature || prev.signature || null,
      supported_task_types: supportedTaskTypes && supportedTaskTypes.length ? supportedTaskTypes : (prev.supported_task_types || null),
      agent_verified: prev.agent_verified ?? null,
      trust_level: prev.trust_level || null,
      trust_state: prev.trust_state || null,
      trust_score: typeof prev.trust_score === 'number' ? prev.trust_score : null,
      invalid_seen_count: typeof prev.invalid_seen_count === 'number' ? prev.invalid_seen_count : 0,
      invalid_streak: typeof prev.invalid_streak === 'number' ? prev.invalid_streak : 0,
      last_invalid_at: prev.last_invalid_at || null,
      last_verified_at: prev.last_verified_at || null
    };

    // Trust layer (soft; do not block behavior):
    // - VERIFIED: signature valid
    // - UNVERIFIED: no signature/public_key
    // - INVALID: bad signature
    try {
      const pk = String(payload?.public_key || '').trim();
      const sigB64 = String(payload?.signature || '').trim();

      if (pk && sigB64) {
        const ok = crypto.verify(null, Buffer.from(String(peer_id), 'utf8'), pk, Buffer.from(sigB64, 'base64'));
        next.agent_verified = ok;

        if (ok) {
          next.trust_level = 'VERIFIED';
          next.last_verified_at = nowIso();
          log('AGENT_ID_VERIFIED', { node_id, peer_id, agent_id: next.agent_id || null });
          log('PEER_TRUST_VERIFIED', { node_id, peer_id, agent_id: next.agent_id || null });
        } else {
          next.trust_level = 'INVALID';
          log('AGENT_ID_INVALID_SIGNATURE', { node_id, peer_id, agent_id: next.agent_id || null });
          log('PEER_TRUST_INVALID', { node_id, peer_id, agent_id: next.agent_id || null });
        }
      } else {
        // No signature/public key -> legacy/unverified
        next.trust_level = 'UNVERIFIED';
        log('PEER_TRUST_UNVERIFIED', { node_id, peer_id, agent_id: next.agent_id || null });
      }
    } catch {
      // fail closed: keep prior verification state
      if (!next.trust_level) next.trust_level = prev.trust_level || 'UNVERIFIED';
    }

    // Trust state + quarantine (light isolation; no full bans)
    // - trust_state starts as trust_level
    // - repeated INVALID can promote to QUARANTINED
    try {
      const tl = String(next.trust_level || 'UNVERIFIED');
      next.trust_state = tl;

      if (tl === 'VERIFIED') {
        next.invalid_streak = 0;
        next.invalid_seen_count = 0;
        next.last_invalid_at = null;
      } else if (tl === 'INVALID') {
        next.invalid_seen_count = (Number(next.invalid_seen_count) || 0) + 1;
        next.invalid_streak = (Number(next.invalid_streak) || 0) + 1;
        next.last_invalid_at = nowIso();

        // Promote to QUARANTINED after multiple persistent invalid sightings
        if (next.invalid_streak >= 3 || next.invalid_seen_count >= 5) {
          next.trust_state = 'QUARANTINED';
        }
      } else {
        // UNVERIFIED (or unknown)
        next.invalid_streak = 0;
      }

      // Normalized trust score
      next.trust_score = next.trust_state === 'VERIFIED' ? 2 : next.trust_state === 'UNVERIFIED' ? 1 : next.trust_state === 'INVALID' ? 0 : next.trust_state === 'QUARANTINED' ? -1 : 1;
    } catch {}

    presenceCache.peers = presenceCache.peers && typeof presenceCache.peers === 'object' ? presenceCache.peers : {};
    presenceCache.peers[peer_id] = next;
    presenceCache.updated_at = nowIso();

    const ageMs = Date.now() - (Date.parse(seenIso) || Date.now());
    const freshness = ageMs <= presenceActiveWindowMs ? 'ACTIVE' : 'STALE';

    log('PEER_PRESENCE_UPDATED', { node_id, peer_id, ts: seenIso, freshness, age_ms: ageMs });

    // Self-healing visibility: network health state (log-only)
    try {
      let v = 0;
      let inv = 0;
      for (const [pid, p] of Object.entries(presenceCache.peers || {})) {
        if (!p || typeof p !== 'object') continue;
        const ts2 = String(p.last_presence_ts || '').trim();
        const age2 = ts2 ? Date.now() - Date.parse(ts2) : 1e18;
        if (!(Number.isFinite(age2) && age2 <= presenceActiveWindowMs)) continue;
        const st = String(p.trust_state || p.trust_level || 'UNVERIFIED');
        if (st === 'VERIFIED') v++;
        else if (st === 'INVALID' || st === 'QUARANTINED') inv++;
      }
      const denom = v + inv;
      const health = denom > 0 ? v / denom : 1;
      const cls = health >= 0.8 ? 'HEALTHY' : health >= 0.5 ? 'MIXED' : 'DEGRADED';
      if (networkHealthClass && networkHealthClass !== cls) {
        if (cls === 'DEGRADED') log('NETWORK_DEGRADED', { node_id, health_score: health, verified: v, invalid: inv });
        if (networkHealthClass === 'DEGRADED' && cls !== 'DEGRADED') log('NETWORK_RECOVERING', { node_id, health_score: health, verified: v, invalid: inv });
      }
      networkHealthClass = cls;
    } catch {}

    void writeJsonAtomic(presenceCachePath, presenceCache).catch(() => {});
  };

  const sendPresenceGossipOnce = (reason = 'periodic') => {
    const payload = buildPresencePayload();
    const targets = (state.known_peers || []).map((p) => p?.node_id).filter((x) => x && x !== node_id);
    const dedup = dedupPreserveOrder(targets);
    const ordered = trustAwareOrder(dedup, { reason: `peer.presence:${reason}` });

    let okCount = 0;
    for (const to of ordered) {
      const out = send({ to, topic: 'peer.presence', payload });
      if (out.ok) okCount++;
    }

    log('PEER_PRESENCE_GOSSIP_SENT', { node_id, peer_count: ordered.length, ok_count: okCount, reason, ts: payload.ts });
  };

  const startPresenceLoop = () => {
    if (presenceGossipTimer) return;
    if (!Number.isFinite(presenceGossipEveryMs) || presenceGossipEveryMs <= 0) return;

    presenceGossipTimer = setInterval(() => {
      try {
        if (state.relay_registered) sendPresenceGossipOnce('periodic');
      } catch {}
    }, presenceGossipEveryMs);
    presenceGossipTimer.unref();

    // small startup kick (best-effort)
    setTimeout(() => {
      try {
        if (state.relay_registered) sendPresenceGossipOnce('startup');
      } catch {}
    }, 1000).unref?.();
  };

  // v0.7.6 capability advertisement + cache (lightweight, relay-only)
  const capabilitiesCachePath = `${dataDir}/capabilities-cache.json`;
  const capabilityMap = new Map(); // node_id -> { capabilities: string[], ts: string }
  let capabilitiesTimer = null;

  const localCapabilities = () => ['echo', 'summarize_text', 'decision_help', 'code_exec_safe', 'simple_search'];

  const recordCapability = ({ from, capabilities, ts }) => {
    const node = String(from || '').trim();
    const caps = Array.isArray(capabilities) ? capabilities.map((x) => String(x).trim()).filter(Boolean).slice(0, 16) : [];
    const t = String(ts || '').trim() || nowIso();
    if (!node || !caps.length) return;
    capabilityMap.set(node, { capabilities: caps, ts: t });
    // best-effort persistence
    try {
      const obj = { ts: nowIso(), nodes: Object.fromEntries(Array.from(capabilityMap.entries())) };
      void writeJsonAtomic(capabilitiesCachePath, obj).catch(() => {});
    } catch {}
  };

  const sendCapabilitiesOnce = (reason = 'periodic') => {
    const payload = { node_id, capabilities: localCapabilities(), ts: nowIso() };

    // include self in cache
    try { recordCapability({ from: node_id, capabilities: payload.capabilities, ts: payload.ts }); } catch {}

    const targets = (state.known_peers || []).map((p) => p?.node_id).filter((x) => x && x !== node_id);
    const ordered = trustAwareOrder(dedupPreserveOrder(targets), { reason: `peer.capabilities:${reason}` });

    let okCount = 0;
    for (const to of ordered) {
      const out = send({ to, topic: 'peer.capabilities', payload });
      if (out.ok) okCount++;
    }

    log('PEER_CAPABILITIES_SENT', { node_id, peer_count: ordered.length, ok_count: okCount, reason, ts: payload.ts });
  };

  const startCapabilitiesLoop = () => {
    if (capabilitiesTimer) return;
    const everyMs = Number(process.env.CAPABILITIES_GOSSIP_EVERY_MS || 120_000);
    if (!Number.isFinite(everyMs) || everyMs <= 0) return;

    capabilitiesTimer = setInterval(() => {
      try {
        if (state.relay_registered) sendCapabilitiesOnce('periodic');
      } catch {}
    }, everyMs);
    capabilitiesTimer.unref();

    setTimeout(() => {
      try {
        if (state.relay_registered) sendCapabilitiesOnce('startup');
      } catch {}
    }, 1500).unref?.();
  };

  // Connection guard (single active connection per node_id)
  let connection_state = 'DISCONNECTED'; // CONNECTING|CONNECTED|DISCONNECTED
  let reconnect_backoff_ms = 500; // 500ms → 1s → 2s → 5s cap
  let reconnect_timer = null;

  const scheduleReconnect = () => {
    if (stopping) return;
    if (reconnect_timer) return;
    const delay = Math.max(0, Math.min(5000, reconnect_backoff_ms));
    log('RELAY_RECONNECT_SCHEDULED', { node_id, delay_ms: delay });
    reconnect_timer = setTimeout(() => {
      reconnect_timer = null;
      void ensureConnected();
    }, delay);
    reconnect_timer.unref();
    reconnect_backoff_ms = Math.min(5000, reconnect_backoff_ms * 2);
  };

  const connectOnce = async ({ relayUrl, index, attempt }) => {
    if (!relayUrl) return { ok: false, error: { code: 'NO_RELAY_URL' } };
    if (!allowLocalRelay && isLocalOnlyUrl(relayUrl)) {
      log('RELAY_CONNECT_ATTEMPT', { node_id, relay_url: relayUrl, index, attempt, skipped: true, reason: 'LOCAL_RELAY_DISALLOWED' });
      return { ok: false, error: { code: 'LOCAL_RELAY_DISALLOWED' } };
    }

    if (connection_state === 'CONNECTING') {
      log('RELAY_CONNECT_SKIPPED_ALREADY_CONNECTING', { node_id, relay_url: relayUrl, index, attempt, state: connection_state });
      return { ok: false, error: { code: 'ALREADY_CONNECTING' } };
    }
    if (connection_state === 'CONNECTED') {
      log('RELAY_CONNECT_SKIPPED_ALREADY_CONNECTED', { node_id, relay_url: relayUrl, index, attempt, state: connection_state });
      return { ok: true, ws: activeWs };
    }

    connection_state = 'CONNECTING';
    log('RELAY_CONNECT_ATTEMPT', { node_id, relay_url: relayUrl, index, attempt, state: connection_state });

    return await new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        resolve(v);
      };

      // Hard global guard: prevent multiple independent WebSocket creators in the same process.
      const g = globalThis;
      if (g.__A2A_ACTIVE_RELAY_WS__ && g.__A2A_ACTIVE_RELAY_WS__.readyState && g.__A2A_ACTIVE_RELAY_WS__.readyState !== 3) {
        log('RELAY_CONNECT_BLOCKED_DUPLICATE', { node_id, relay_url: relayUrl, state: connection_state });
        connection_state = 'DISCONNECTED';
        finish({ ok: false, error: { code: 'DUPLICATE_WS_BLOCKED' } });
        return;
      }

      if (!WebSocketCtor) {
        connection_state = 'DISCONNECTED';
        finish({ ok: false, error: { code: 'NO_WEBSOCKET' } });
        return;
      }

      const conn_id = crypto.randomUUID();
      const ws = new WebSocketCtor(relayUrl);
      ws.__a2a_conn_id = conn_id;
      g.__A2A_ACTIVE_RELAY_WS__ = ws;
      let registered = false;

      const timeout = setTimeout(() => {
        try { ws.close(); } catch {}
        finish({ ok: false, error: { code: 'REGISTER_TIMEOUT' } });
      }, 8000);
      timeout.unref();

      ws.onopen = () => {
        state.relay_connected = true;
        log('RELAY_CONNECT_OK', { node_id, relay_url: relayUrl, conn_id });
        ws.send(JSON.stringify({ type: 'REGISTER', from: node_id }));
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        try { ws.close(); } catch {}
        connection_state = 'DISCONNECTED';
        finish({ ok: false, error: { code: 'WS_ERROR' } });
      };

      ws.onmessage = async (ev) => {
        let msg = null;
        try { msg = JSON.parse(String(ev.data)); } catch { return; }
        state.last_message_at = nowIso();

        if (msg?.type === 'REGISTER_ACK' && msg?.to === node_id && msg?.accepted === true) {
          clearTimeout(timeout);
          registered = true;
          state.relay_registered = true;
          state.relay_url = relayUrl;
          connection_state = 'CONNECTED';
          reconnect_backoff_ms = 500;
          try { if (reconnect_timer) clearTimeout(reconnect_timer); } catch {}
          reconnect_timer = null;
          log('RELAY_REGISTER_OK', { node_id, relay_url: relayUrl, conn_id });

          // Keepalive: WS ping every 25s to prevent idle drops (relay replies with pong).
          try {
            const pingEveryMs = Number(process.env.RELAY_PING_EVERY_MS || 25_000);
            if (pingEveryMs > 0) {
              const pingTimer = setInterval(() => {
                try {
                  if (ws && typeof ws.ping === 'function') ws.ping();
                } catch {}
              }, pingEveryMs);
              pingTimer.unref();
              ws.__a2a_ping_timer = pingTimer;
              log('RELAY_KEEPALIVE_ENABLED', { node_id, relay_url: relayUrl, conn_id, ping_every_ms: pingEveryMs });
            }
          } catch {}

          // Ensure send() can work immediately after register
          activeWs = ws;

          // Start peer gossip after successful register
          startGossipLoop();
          try { sendPeerGossipOnce('after_register'); } catch {}

          // Start peer presence gossip (P2P liveness propagation)
          startPresenceLoop();

          // Auto responder activation (v0.8.2)
          try {
            const supportedTaskTypes = ['echo', 'summarize_text', 'decision_help', 'code_exec_safe', 'runtime_status', 'network_snapshot', 'trust_summary', 'presence_status', 'capability_summary'];
            log('RESPONDER_ENABLED', { node_id, relay_url: relayUrl, supported_task_types: supportedTaskTypes, ts: nowIso() });
            log('RESPONDER_SUBSCRIBED', { node_id, relay_url: relayUrl, topic: 'peer.task.request', ts: nowIso() });
            log('RESPONDER_READY', { node_id, relay_url: relayUrl, supported_task_types: supportedTaskTypes, ts: nowIso() });
          } catch {}

          // Start capability gossip (v0.7.6)
          startCapabilitiesLoop();
          try { sendCapabilitiesOnce('after_register'); } catch {}

          // Announce join to known peers (P2P only; no bootstrap involvement)
          try { sendJoinAnnounceOnce(); } catch {}

          // attach handlers for runtime receive loop
          ws.onmessage = async (ev2) => {
            let m2 = null;
            try { m2 = JSON.parse(String(ev2.data)); } catch { return; }
            state.last_message_at = nowIso();

            if (m2?.type === 'DELIVER') {
              const topic = m2?.data?.topic ?? null;
              const payload = m2?.data?.payload ?? null;

              log('RELAY_MESSAGE_RECEIVED', {
                node_id,
                from: m2?.from ?? null,
                to: m2?.to ?? null,
                message_id: m2?.message_id ?? null,
                topic
              });

              // peer.gossip (supplemental discovery)
              if (topic === 'peer.gossip') {
                const peersIn = Array.isArray(payload?.peers) ? payload.peers : [];
                log('PEER_GOSSIP_RECEIVED', { node_id, peer_count: peersIn.length });

                const merged = mergePeersByNodeId({ existing: state.known_peers || [], incoming: peersIn, selfNodeId: node_id });
                state.known_peers = merged.peers;

                void writeJsonAtomic(state.peer_cache_path, { ok: true, protocol: 'a2a/0.1', updated_at: nowIso(), peers: state.known_peers }).catch(() => {});

                log('PEER_CACHE_MERGED_FROM_GOSSIP', { node_id, peer_count: state.known_peers.length, added: merged.added, updated: merged.updated });
                return;
              }

              // peer.presence (P2P-native liveness)
              if (topic === 'peer.presence') {
                const peer_id = String(payload?.node_id || m2?.from || '').trim();
                log('PEER_PRESENCE_GOSSIP_RECEIVED', { node_id, peer_id: peer_id || null, ts: payload?.ts || null });
                void mergePresenceIntoCache({ peer_id, payload });
                return;
              }

              // node.join.announce → randomized welcome back (P2P first contact)
              if (topic === 'node.join.announce') {
                const peer_id = String(payload?.node_id || m2?.from || '').trim();
                if (!peer_id || peer_id === node_id) return;

                // Record presence too (helps local liveness even if peer.presence not yet adopted)
                try { void mergePresenceIntoCache({ peer_id, payload: { ...payload, node_id: peer_id } }); } catch {}

                if (shouldSendWelcome(peer_id)) {
                  const w = { to: peer_id, from: node_id, ts: nowIso() };
                  const out = send({ to: peer_id, topic: 'node.join.welcome', payload: w });
                  if (out.ok) welcomeSentTo.set(peer_id, Date.now());
                  log('JOIN_WELCOME_SENT', { node_id, to: peer_id, ok: out.ok, ts: w.ts });
                }
                return;
              }

              // node.join.welcome → store if it's for self
              if (topic === 'node.join.welcome') {
                const toId = String(payload?.to || '').trim();
                const fromId = String(payload?.from || m2?.from || '').trim();
                if (toId && toId === node_id && fromId) {
                  recordWelcomeReceived({ from: fromId, ts: payload?.ts || null });
                  log('JOIN_WELCOME_RECEIVED', { node_id, from: fromId, ts: payload?.ts || null });
                }
                return;
              }

              // First collaboration: request help (echo_ack)
              if (topic === 'peer.help.request' && payload?.request_type === 'echo_ack') {
                const fromId = String(payload?.from || m2?.from || '').trim();
                const requestId = String(payload?.request_id || '').trim();
                if (fromId && fromId !== node_id && requestId) {
                  log('HELP_REQUEST_RECEIVED', { node_id, from: fromId, request_id: requestId, ts_in: payload?.ts || null });
                  const resp = { request_id: requestId, status: 'ok', from: node_id, ts: nowIso(), message: 'acknowledged' };
                  const out = send({ to: fromId, topic: 'peer.help.response', payload: resp, message_id: requestId });
                  log('HELP_RESPONSE_SENT', { node_id, to: fromId, request_id: requestId, ok: out.ok, ts: resp.ts });
                }
                return;
              }

              if (topic === 'peer.help.response' && payload?.request_id) {
                // Receiver-side visibility (sender already logs in capability; daemon can also log if it receives one)
                log('HELP_RESPONSE_RECEIVED', { node_id, from: m2?.from ?? null, request_id: payload?.request_id, status: payload?.status || null });
                return;
              }

              // v0.7.6 capability advertisement
              if (topic === 'peer.capabilities') {
                const fromId = String(payload?.node_id || payload?.from || m2?.from || '').trim();
                const caps = Array.isArray(payload?.capabilities) ? payload.capabilities : null;
                const tsIn = payload?.ts || null;
                if (fromId && fromId !== node_id && caps && caps.length) {
                  try { recordCapability({ from: fromId, capabilities: caps, ts: tsIn }); } catch {}
                  log('PEER_CAPABILITIES_RECEIVED', { node_id, from: fromId, capability_count: caps.length, ts_in: tsIn });
                }
                return;
              }

              // Safe task types framework (read-only)
              if (topic === 'peer.task.request') {
                const fromId = String(payload?.from || m2?.from || '').trim();
                const requestId = String(payload?.request_id || '').trim();
                let taskType = String(payload?.task_type || payload?.check_type || '').trim();
                // Minimal echo fallback for generic task strings (v0.7.0 first responder).
                if (!taskType && typeof payload?.task === 'string' && String(payload.task).trim()) taskType = 'echo';

                const supported = new Set(['echo', 'summarize_text', 'decision_help', 'code_exec_safe', 'simple_search', 'runtime_status', 'network_snapshot', 'trust_summary', 'presence_status', 'capability_summary']);

                if (fromId && fromId !== node_id && requestId && supported.has(taskType)) {
                  log('TASK_RECEIVED', { node_id, from: fromId, request_id: requestId, task_type: taskType, ts_in: payload?.ts || null });
                  const execStartMs = Date.now();
                  log('TASK_EXECUTION_STARTED', { node_id, responder_id: node_id, from: fromId, request_id: requestId, task_type: taskType });

                  const trust_status = (process.env.AGENT_SIGNATURE && process.env.AGENT_PUBLIC_KEY) ? 'VERIFIED' : 'UNVERIFIED';

                  let result = null;

                  if (taskType === 'echo') {
                    result = { message: `echo: ${String(payload?.task || '').trim()}` };
                  }

                  if (taskType === 'summarize_text') {
                    const text = String(payload?.payload?.text ?? payload?.task ?? '').trim();
                    const maxLen = Math.max(50, Math.min(1200, Number(payload?.payload?.max_len || 400) || 400));
                    const clipped = text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
                    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
                    result = {
                      summary: clipped,
                      input_chars: text.length,
                      word_count: words,
                      clipped: text.length > maxLen
                    };
                  }

                  if (taskType === 'decision_help') {
                    const question = String(payload?.payload?.question ?? payload?.task ?? '').trim();
                    const optionsRaw = payload?.payload?.options;
                    const options = Array.isArray(optionsRaw) ? optionsRaw.map((x) => String(x).trim()).filter(Boolean).slice(0, 10) : [];
                    result = {
                      question: question || null,
                      options,
                      recommendation: options.length ? options[0] : null,
                      reasoning: options.length ? 'Defaulting to first option (minimal decision helper; no external context).' : 'No options provided.'
                    };
                  }

                  if (taskType === 'code_exec_safe') {
                    // Safety: only allow basic arithmetic expressions.
                    const expr = String(payload?.payload?.expression ?? payload?.task ?? '').trim();
                    const ok = /^[0-9\s+\-*/().]+$/.test(expr) && expr.length > 0 && expr.length <= 200;
                    if (!ok) {
                      result = { status: 'unsupported', reason: 'Only basic arithmetic expressions are allowed.' };
                    } else {
                      let value = null;
                      try {
                        // eslint-disable-next-line no-new-func
                        value = Function(`"use strict"; return (${expr});`)();
                      } catch {
                        value = null;
                      }
                      result = { expression: expr, value };
                    }
                  }

                  if (taskType === 'simple_search') {
                    result = { status: 'unsupported', reason: 'Search provider not configured on responder node.' };
                  }

                  if (taskType === 'capability_summary') {
                    result = {
                      node_id,
                      supported_task_types: ['echo', 'summarize_text', 'decision_help', 'code_exec_safe', 'simple_search', 'runtime_status', 'network_snapshot', 'trust_summary', 'presence_status', 'capability_summary'],
                      protocol_version: 'v0.1',
                      trust_status
                    };
                  }

                  if (taskType === 'runtime_status') {
                    result = {
                      node_id,
                      daemon_running: true,
                      relay_connected: true,
                      trust_status
                    };
                  }

                  if (taskType === 'network_snapshot') {
                    try {
                      const snap = await getNetworkSnapshot({ bootstrap_timeout_ms: 500 }).catch(() => null);
                      result = {
                        node_id,
                        total_nodes: snap?.total_nodes ?? null,
                        active_peer_count: Array.isArray(snap?.active_peers) ? snap.active_peers.length : null,
                        country_count: snap?.country_breakdown ? Object.keys(snap.country_breakdown).length : null
                      };
                    } catch {
                      result = { node_id, error: 'SNAPSHOT_FAILED' };
                    }
                  }

                  if (taskType === 'trust_summary') {
                    try {
                      const snap = await getNetworkSnapshot({ bootstrap_timeout_ms: 500 }).catch(() => null);
                      const gp = Array.isArray(snap?.gossip_peers) ? snap.gossip_peers : [];
                      const counts = { VERIFIED: 0, UNVERIFIED: 0, INVALID: 0 };
                      for (const p of gp) {
                        const t = String(p?.trust_level || 'UNVERIFIED');
                        if (t === 'VERIFIED') counts.VERIFIED++;
                        else if (t === 'INVALID') counts.INVALID++;
                        else counts.UNVERIFIED++;
                      }
                      result = { node_id, trust_status, peers: counts };
                    } catch {
                      result = { node_id, trust_status, error: 'TRUST_SUMMARY_FAILED' };
                    }
                  }

                  if (taskType === 'presence_status') {
                    try {
                      const snap = await getNetworkSnapshot({ bootstrap_timeout_ms: 500 }).catch(() => null);
                      result = {
                        node_id,
                        trust_status,
                        active_peer_count: Array.isArray(snap?.active_peers) ? snap.active_peers.length : null,
                        gossip_peer_count: Array.isArray(snap?.gossip_peers) ? snap.gossip_peers.length : null,
                        bootstrap_peer_count: Array.isArray(snap?.bootstrap_peers) ? snap.bootstrap_peers.length : null
                      };
                    } catch {
                      result = { node_id, trust_status, error: 'PRESENCE_STATUS_FAILED' };
                    }
                  }

                  const durationMs = Date.now() - execStartMs;
                  const resultSummary = (() => {
                    try {
                      if (taskType === 'echo') return String(result?.message || '').slice(0, 120);
                      if (taskType === 'summarize_text') return String(result?.summary || '').slice(0, 120);
                      if (taskType === 'decision_help') return String(result?.recommendation || '').slice(0, 120);
                      if (taskType === 'code_exec_safe') return `value=${String(result?.value)}`;
                      if (taskType === 'simple_search') return String(result?.reason || 'unsupported').slice(0, 120);
                      return 'ok';
                    } catch {
                      return 'ok';
                    }
                  })();

                  log('TASK_EXECUTION_COMPLETED', { node_id, responder_id: node_id, request_id: requestId, task_type: taskType, duration_ms: durationMs, result_summary: resultSummary });

                  const statusOut = (taskType === 'simple_search' || (taskType === 'code_exec_safe' && result?.status === 'unsupported')) ? 'unsupported' : 'success';
                  const resp = {
                    request_id: requestId,
                    status: statusOut,
                    from: node_id,
                    ts: nowIso(),
                    task_type: taskType,
                    execution_time_ms: durationMs,
                    summary: `Task handled by ${node_id} in ${durationMs}ms`,
                    result
                  };
                  const out = send({ to: fromId, topic: 'peer.task.response', payload: resp, message_id: requestId });
                  log('TASK_RESPONSE_SENT', { node_id, to: fromId, request_id: requestId, task_type: taskType, ok: out.ok, ts: resp.ts });
                  return;
                }

                if (fromId && fromId !== node_id && requestId) {
                  log('TASK_REQUEST_UNSUPPORTED', { node_id, from: fromId, request_id: requestId, task_type: taskType || null });
                  const resp = {
                    request_id: requestId,
                    status: 'error',
                    from: node_id,
                    ts: nowIso(),
                    task_type: taskType || null,
                    result: { error: 'UNSUPPORTED_TASK_TYPE' }
                  };
                  const out = send({ to: fromId, topic: 'peer.task.response', payload: resp, message_id: requestId });
                  log('TASK_RESPONSE_SENT', { node_id, to: fromId, request_id: requestId, task_type: taskType || null, ok: out.ok, ts: resp.ts });
                }
                return;
              }

              if (topic === 'peer.task.response' && payload?.request_id) {
                log('TASK_RESPONSE_RECEIVED', { node_id, from: m2?.from ?? null, request_id: payload?.request_id, status: payload?.status || null });
                return;
              }

              // Human-first interaction: ping peer
              if (topic === 'peer.ping' && payload?.type === 'PING') {
                const fromId = String(payload?.from || m2?.from || '').trim();
                if (fromId && fromId !== node_id) {
                  log('PING_RECEIVED', { node_id, from: fromId, ts_in: payload?.ts || null });
                  // Optional reply: PONG
                  const pong = { type: 'PONG', to: fromId, from: node_id, ts: nowIso() };
                  const out = send({ to: fromId, topic: 'peer.pong', payload: pong });
                  log('PONG_SENT', { node_id, to: fromId, ok: out.ok, ts: pong.ts });
                }
                return;
              }

              if (topic === 'peer.pong' && payload?.type === 'PONG') {
                const toId = String(payload?.to || '').trim();
                const fromId = String(payload?.from || m2?.from || '').trim();
                if (toId && toId === node_id && fromId) {
                  log('PONG_RECEIVED', { node_id, from: fromId, ts_in: payload?.ts || null });
                }
                return;
              }

              try {
                if (typeof onDeliver === 'function') {
                  onDeliver({
                    node_id,
                    from: m2?.from ?? null,
                    to: m2?.to ?? null,
                    message_id: m2?.message_id ?? null,
                    topic,
                    payload
                  });
                }
              } catch {}
              return;
            }

            if (m2?.type === 'ERROR') {
              const mid = m2?.message_id ?? null;
              const err = m2?.error ?? null;
              log('RELAY_MESSAGE_RECEIVED', { node_id, error: err, message_id: mid });

              // Transport trace: for telemetry sends, surface async relay-side rejection.
              try {
                if (typeof mid === 'string' && mid.startsWith('task.telemetry:')) {
                  log('RELAY_SEND_FAILED', { node_id, message_id: mid, error: { code: 'RELAY_ERROR', relay_error: err } });
                }
              } catch {}
            }
          };

          ws.onclose = () => {
            if (stopping) return;
            state.relay_connected = false;
            state.relay_registered = false;
            connection_state = 'DISCONNECTED';
            try { if (ws && ws.__a2a_ping_timer) clearInterval(ws.__a2a_ping_timer); } catch {}
            try { if (globalThis.__A2A_ACTIVE_RELAY_WS__ === ws) globalThis.__A2A_ACTIVE_RELAY_WS__ = null; } catch {}
            log('RELAY_DISCONNECTED', { node_id, relay_url: relayUrl, conn_id });
            // schedule reconnect with exponential backoff (no immediate storm)
            scheduleReconnect();
          };

          finish({ ok: true, ws });
          return;
        }
      };

      ws.onclose = () => {
        if (registered) return;
        clearTimeout(timeout);
        connection_state = 'DISCONNECTED';
        try { if (globalThis.__A2A_ACTIVE_RELAY_WS__ === ws) globalThis.__A2A_ACTIVE_RELAY_WS__ = null; } catch {}
        finish({ ok: false, error: { code: 'CLOSED_BEFORE_REGISTER' } });
      };
    });
  };

  let reconnecting = false;

  const ensureConnected = async () => {
    if (reconnecting) return;
    if (connection_state === 'CONNECTING') return;
    if (connection_state === 'CONNECTED') return;
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
      if (connection_state === 'CONNECTING') connection_state = 'DISCONNECTED';
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
      try { if (presenceTimer) clearInterval(presenceTimer); } catch {}
      try { if (presenceGossipTimer) clearInterval(presenceGossipTimer); } catch {}
      try { if (gossipTimer) clearInterval(gossipTimer); } catch {}
      try { if (reconnect_timer) clearTimeout(reconnect_timer); } catch {}
      reconnect_timer = null;
      try { if (activeWs) activeWs.close(); } catch {}
      activeWs = null;
      connection_state = 'DISCONNECTED';
    }
  };
}
