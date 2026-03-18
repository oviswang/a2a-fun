import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

function nowIso() {
  return new Date().toISOString();
}

function flagFromCc(cc) {
  const c = String(cc || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '🌍';
  const A = 0x1f1e6;
  const a = 'A'.charCodeAt(0);
  return String.fromCodePoint(A + (c.charCodeAt(0) - a), A + (c.charCodeAt(1) - a));
}

function countryNameFromCc(cc) {
  const c = String(cc || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return 'Unknown';
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    return dn.of(c) || c;
  } catch {
    return c;
  }
}

async function readJsonSafe(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

async function fetchJson(url, { timeoutMs = 1200 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal });
    const j = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, json: j };
  } catch (e) {
    return { ok: false, status: 0, json: null, error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function pickCountryCodeFromPeer(peer) {
  // Prefer explicit peer-level country_code when available.
  const direct = peer?.country_code ? String(peer.country_code).trim().toUpperCase() : '';
  if (/^[A-Z]{2}$/.test(direct)) return direct;

  const addrs = Array.isArray(peer?.observed_addrs) ? peer.observed_addrs : [];
  for (const a of addrs) {
    if (!a || typeof a !== 'object') continue;
    const cc = a.country_code ? String(a.country_code).trim().toUpperCase() : '';
    if (/^[A-Z]{2}$/.test(cc)) return cc;
    const r = a.region ? String(a.region).trim().toUpperCase() : '';
    if (/^[A-Z]{2}$/.test(r)) return r;
  }
  return null;
}

function sortIds(xs) {
  return [...xs].sort((a, b) => String(a).localeCompare(String(b)));
}

export async function getNetworkSnapshot({
  workspace_path = null,
  bootstrap_base_url = null,
  presence_active_window_ms = null,
  bootstrap_timeout_ms = 1200
} = {}) {
  // Workspace resolution:
  // - Prefer explicit workspace_path / A2A_WORKSPACE_PATH
  // - Fallback: if invoked from a parent workspace (e.g. /home/ubuntu/.openclaw/workspace),
  //   auto-detect ./a2a-fun as the real node workspace.
  let ws = workspace_path || process.env.A2A_WORKSPACE_PATH || process.cwd();
  try {
    const hasNodeId = await fs.readFile(path.join(ws, 'data', 'node_id'), 'utf8').then((r) => !!String(r||'').trim()).catch(() => false);
    if (!hasNodeId) {
      const ws2 = path.join(ws, 'a2a-fun');
      const has2 = await fs.readFile(path.join(ws2, 'data', 'node_id'), 'utf8').then((r) => !!String(r||'').trim()).catch(() => false);
      if (has2) ws = ws2;
    }
  } catch {}

  const base = String(bootstrap_base_url || process.env.BOOTSTRAP_BASE_URL || 'https://bootstrap.a2a.fun').replace(/\/$/, '');
  const peersUrl = `${base}/peers`;

  const presenceWindowMs = Number(presence_active_window_ms || process.env.PRESENCE_ACTIVE_WINDOW_MS || 120_000);

  // --------------------
  // Self identity resolution (strict order; user-trustable)
  // --------------------

  // 1) node_id
  let selfNodeId = null;
  // PRIMARY: $A2A_WORKSPACE_PATH/data/node_id (resolved workspace)
  try {
    const raw = await fs.readFile(path.join(ws, 'data', 'node_id'), 'utf8');
    const v = String(raw || '').trim();
    if (v) selfNodeId = v;
  } catch {}
  // SECONDARY: process.env.NODE_ID
  if (!selfNodeId) {
    const v = String(process.env.NODE_ID || '').trim();
    if (v) selfNodeId = v;
  }
  // FALLBACK: runtime state (if available)
  if (!selfNodeId) {
    try {
      const st = await readJsonSafe(path.join(ws, 'data', 'runtime_state.json'));
      const v = String(st?.node_id || st?.holder || '').trim();
      if (v) selfNodeId = v;
    } catch {}
  }
  // IF ALL FAIL
  if (!selfNodeId) selfNodeId = 'unknown (node not initialized)';

  // 2) version
  let selfVersion = null;
  // PRIMARY: git HEAD (short)
  try {
    const rev = String(execSync('git rev-parse --short HEAD', { cwd: ws, stdio: ['ignore', 'pipe', 'ignore'] })).trim();
    if (rev) selfVersion = rev;
  } catch {}
  // SECONDARY: package.json version
  if (!selfVersion) {
    try {
      const pkg = await readJsonSafe(path.join(ws, 'package.json'));
      if (pkg?.version) selfVersion = String(pkg.version);
    } catch {}
  }
  // FALLBACK
  if (!selfVersion) selfVersion = 'unknown';

  // 3) country_code
  // PRIMARY: local cached value (presence-cache/runtime/local config)
  let selfCountryCode = null;
  try {
    const ccFile = await fs.readFile(path.join(ws, 'data', 'country_code'), 'utf8').catch(() => null);
    const v = String(ccFile || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(v)) selfCountryCode = v;
  } catch {}
  if (!selfCountryCode) {
    const v = String(process.env.COUNTRY_CODE || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(v)) selfCountryCode = v;
  }
  if (!selfCountryCode) {
    try {
      const pc0 = await readJsonSafe(path.join(ws, 'data', 'presence-cache.json'));
      const entry = pc0?.peers && typeof pc0.peers === 'object' ? pc0.peers[selfNodeId] : null;
      const v = String(entry?.country_code || '').trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(v)) selfCountryCode = v;
    } catch {}
  }
  if (!selfCountryCode) {
    try {
      const st = await readJsonSafe(path.join(ws, 'data', 'runtime_state.json'));
      const v = String(st?.country_code || '').trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(v)) selfCountryCode = v;
    } catch {}
  }

  // Bootstrap peers
  const boot = await fetchJson(peersUrl, { timeoutMs: bootstrap_timeout_ms });
  const peers = Array.isArray(boot.json?.peers) ? boot.json.peers : [];

  const bootstrap_peers = peers
    .map((p) => {
      const node_id = p?.node_id ? String(p.node_id) : null;
      if (!node_id) return null;
      const cc = pickCountryCodeFromPeer(p);
      const addrsLen = Array.isArray(p?.observed_addrs) ? p.observed_addrs.length : 0;
      return {
        node_id,
        last_seen: p?.last_seen || null,
        country_code: cc || null,
        observed_addrs_len: addrsLen
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.node_id).localeCompare(String(b.node_id)));

  const bootIds = new Set(bootstrap_peers.map((p) => p.node_id));

  // If country_code wasn't available locally, try to derive from bootstrap's view of self.
  if (!selfCountryCode && selfNodeId && !selfNodeId.startsWith('unknown')) {
    const selfRow = peers.find((p) => String(p?.node_id || '') === selfNodeId) || null;
    const cc = selfRow ? pickCountryCodeFromPeer(selfRow) : null;
    if (cc) selfCountryCode = cc;
  }

  // Gossip peers from local presence-cache
  const presenceCachePath = path.join(ws, 'data', 'presence-cache.json');
  const pc = await readJsonSafe(presenceCachePath);
  const rawPeers = pc && pc.peers && typeof pc.peers === 'object' ? Object.values(pc.peers) : [];

  const gossip_peers = rawPeers
    .map((x) => {
      const node_id = String(x?.peer_id || '').trim();
      if (!node_id) return null;
      const ts = x?.last_presence_ts || null;
      const ageMs = ts ? Date.now() - Date.parse(ts) : NaN;
      const active = Number.isFinite(ageMs) && ageMs <= presenceWindowMs;
      const cc = x?.country_code ? String(x.country_code).trim().toUpperCase() : null;
      return {
        node_id,
        last_presence_ts: ts,
        age_ms: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs)) : null,
        freshness: active ? 'ACTIVE' : 'STALE',
        version: x?.version || null,
        country_code: cc && /^[A-Z]{2}$/.test(cc) ? cc : null
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.node_id).localeCompare(String(b.node_id)));

  const gossipIds = new Set(gossip_peers.map((p) => p.node_id));

  // Country distribution (from bootstrap peers; fallback safe)
  const byCc = new Map();
  for (const p of bootstrap_peers) {
    const cc = p.country_code || 'unknown';
    byCc.set(cc, (byCc.get(cc) || 0) + 1);
  }
  const country_distribution = [...byCc.entries()]
    .map(([cc, count]) => ({
      country_code: cc === 'unknown' ? null : cc,
      country: cc === 'unknown' ? 'Unknown' : countryNameFromCc(cc),
      count
    }))
    .sort((a, b) => b.count - a.count || String(a.country || '').localeCompare(String(b.country || '')));

  const active_peers = gossip_peers
    .filter((p) => p.freshness === 'ACTIVE')
    .sort((a, b) => (a.age_ms ?? 1e18) - (b.age_ms ?? 1e18));

  const total_nodes = boot.ok ? bootIds.size : gossipIds.size;

  return {
    ok: true,
    version: 'NETWORK_SNAPSHOT_V0_1',
    ts: nowIso(),
    sources: {
      bootstrap_peers_url: peersUrl,
      bootstrap_ok: !!boot.ok,
      presence_cache_path: presenceCachePath
    },
    self: {
      node_id: selfNodeId,
      version: selfVersion,
      country_code: selfCountryCode
    },
    total_nodes,
    bootstrap_peers,
    gossip_peers,
    country_distribution,
    active_peers
  };
}

export function formatNetworkSnapshotHuman(snapshot, { topCountries = 6, maxActivePeers = 8 } = {}) {
  const s = snapshot || {};
  const lines = [];

  lines.push('🌐 A2A NETWORK');
  lines.push('');
  lines.push(`Total nodes: ${typeof s.total_nodes === 'number' ? s.total_nodes : 'unknown'}`);
  lines.push('');

  const dist = Array.isArray(s.country_distribution) ? s.country_distribution : [];
  for (const c of dist.slice(0, Math.max(1, topCountries))) {
    const cc = c.country_code;
    const flag = cc ? flagFromCc(cc) : '🌍';
    lines.push(`${flag} ${c.country || 'Unknown'}: ${c.count}`);
  }

  lines.push('');
  lines.push('🟢 Active peers:');
  const act = Array.isArray(s.active_peers) ? s.active_peers : [];
  if (!act.length) {
    lines.push('- (none yet)');
  } else {
    for (const p of act.slice(0, Math.max(1, maxActivePeers))) {
      const sec = typeof p.age_ms === 'number' ? Math.round(p.age_ms / 1000) : null;
      lines.push(`- ${p.node_id} — ${sec ?? '?'}s ago`);
    }
  }

  lines.push('');
  const you = s.self?.node_id || 'unknown (node not initialized)';
  lines.push(`You are: ${you}`);

  const cc = s.self?.country_code;
  if (cc && /^[A-Z]{2}$/.test(String(cc))) {
    lines.push(`Your location: ${flagFromCc(cc)} ${countryNameFromCc(cc)}`);
  }

  return lines.join('\n');
}
