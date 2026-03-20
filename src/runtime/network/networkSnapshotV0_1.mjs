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

  // 2) version (normalized, user-facing)
  // Use git tag + verified release manifest when available; never surface package.json as primary.
  let selfVersion = 'unknown';
  try {
    const { getNormalizedVersionInfo } = await import('../versionInfo.mjs');
    const v = await getNormalizedVersionInfo({ workspace_path: ws });
    if (v?.current_version) selfVersion = String(v.current_version);
  } catch {
    // Hard fallback: keep previous behavior, but avoid package.json as primary.
    try {
      const rev = String(execSync('git rev-parse --short HEAD', { cwd: ws, stdio: ['ignore', 'pipe', 'ignore'] })).trim();
      if (rev) selfVersion = rev;
    } catch {}
  }

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

  // agent_id (optional; node works without it)
  let selfAgentId = null;
  try {
    const raw = await fs.readFile(path.join(ws, 'data', 'agent_id'), 'utf8').catch(() => null);
    const v = raw && String(raw).trim() ? String(raw).trim() : null;
    if (v) selfAgentId = v;
  } catch {}

  // Self trust context (local): if binding includes public_key + signature, self is VERIFIED.
  let selfTrustLevel = 'UNVERIFIED';
  try {
    const b = await readJsonSafe(path.join(ws, 'data', 'identity_binding.json'));
    const hasPk = !!String(b?.public_key || '').trim();
    const hasSig = !!String(b?.signature || '').trim();
    if (hasPk && hasSig) selfTrustLevel = 'VERIFIED';
    else if (!selfAgentId) selfTrustLevel = 'UNVERIFIED';
  } catch {}
  const selfTrustScore = selfTrustLevel === 'VERIFIED' ? 2 : selfTrustLevel === 'INVALID' ? 0 : 1;

  // Local upgrade/version state (best-effort, additive)
  const localVersionObj = await readJsonSafe(path.join(ws, 'data', 'local_version'));
  const upgradeStateObj = await readJsonSafe(path.join(ws, 'data', 'upgrade_state.json'));
  const selfCurrentVersion = localVersionObj && typeof localVersionObj === 'object' ? (localVersionObj.version || null) : null;
  const selfTargetVersion = upgradeStateObj && typeof upgradeStateObj === 'object' ? (upgradeStateObj.target_version || null) : null;
  const selfUpgradeState = upgradeStateObj && typeof upgradeStateObj === 'object' ? (upgradeStateObj.state || null) : null;
  const selfReleaseSigStatus = upgradeStateObj && typeof upgradeStateObj === 'object' ? (upgradeStateObj.release_signature_status || null) : null;
  const selfReleaseSource = upgradeStateObj && typeof upgradeStateObj === 'object' ? (upgradeStateObj.release_source || null) : null;

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
        node_version: x?.node_version || x?.version || null,
        upgrade_state: x?.upgrade_state || null,
        agent_id: x?.agent_id || null,
        supported_task_types: Array.isArray(x?.supported_task_types) ? x.supported_task_types : null,
        trust_level: x?.trust_level || null,
        trust_state: x?.trust_state || x?.trust_level || null,
        trust_score: typeof x?.trust_score === 'number' ? x.trust_score : null,
        last_verified_at: x?.last_verified_at || null,
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

  const trustRank = (t) => (t === 'VERIFIED' ? 0 : t === 'INVALID' ? 2 : 1);
  const active_peers = gossip_peers
    .filter((p) => p.freshness === 'ACTIVE')
    .sort((a, b) => {
      const ra = trustRank(a.trust_level);
      const rb = trustRank(b.trust_level);
      if (ra !== rb) return ra - rb;
      return (a.age_ms ?? 1e18) - (b.age_ms ?? 1e18);
    });

  const total_nodes = boot.ok ? bootIds.size : gossipIds.size;

  // Welcome signals (P2P first contact): local file, max 5.
  const welcomePath = path.join(ws, 'data', 'welcome-signals.json');
  const welcomeRaw = await readJsonSafe(welcomePath);
  const welcomes = Array.isArray(welcomeRaw?.welcomes) ? welcomeRaw.welcomes : [];
  const welcome_signals = welcomes
    .map((w) => {
      const from = String(w?.from || '').trim();
      const ts = w?.ts || w?.received_at || null;
      const ageMs = ts ? Date.now() - Date.parse(ts) : NaN;
      return {
        from: from || null,
        ts,
        age_ms: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs)) : null
      };
    })
    .filter((w) => w.from)
    .slice(0, 5);

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
      agent_id: selfAgentId,
      version: selfVersion,
      country_code: selfCountryCode,
      trust_level: selfTrustLevel,
      trust_score: selfTrustScore,
      current_version: selfCurrentVersion,
      target_version: selfTargetVersion,
      upgrade_state: selfUpgradeState,
      release_signature_status: selfReleaseSigStatus,
      release_source: selfReleaseSource
    },
    total_nodes,
    bootstrap_peers,
    gossip_peers,
    country_distribution,
    active_peers,
    welcome_signals,
    network_observation_latest: await readJsonSafe(path.join(ws, 'data', 'network_observation.latest.json'))
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

  // Network Health (VERIFIED / (VERIFIED + INVALID))
  try {
    const gpAll = Array.isArray(s.gossip_peers) ? s.gossip_peers : [];
    let v = 0, u = 0, i = 0, q = 0;
    for (const p of gpAll) {
      const st = String(p?.trust_state || p?.trust_level || 'UNVERIFIED');
      if (st === 'VERIFIED') v++;
      else if (st === 'QUARANTINED') q++;
      else if (st === 'INVALID') i++;
      else u++;
    }
    const denom = v + i + q;
    const health = denom > 0 ? v / denom : 1;
    const pct = Math.round(health * 100);
    const badge = pct >= 80 ? '🟢 Healthy' : pct >= 50 ? '🟡 Mixed' : '🔴 Degraded';

    lines.push('');
    lines.push('--------------------------------');
    lines.push('Network Health');
    lines.push('--------------------------------');
    lines.push(`Network Health: ${pct}% ${badge}`);
    lines.push(`(VERIFIED: ${v}, UNVERIFIED: ${u}, INVALID: ${i}, QUARANTINED: ${q})`);
    lines.push(`peer_count: ${gpAll.length}`);

    // Details (lightweight, human-facing)
    lines.push('');
    lines.push('--------------------------------');
    lines.push('Network Health Details');
    lines.push('--------------------------------');

    const reasons = [];
    if (gpAll.length > 0 && u / gpAll.length >= 0.6) {
      reasons.push(`High UNVERIFIED ratio (${u}/${gpAll.length})`);
    }
    if (i + q > 0) {
      reasons.push(`${i} INVALID peer(s) detected` + (q > 0 ? `, ${q} quarantined` : ''));
    }
    if (!reasons.length) reasons.push('No obvious trust issues detected');

    lines.push('Reason:');
    for (const r of reasons) lines.push(`- ${r}`);

    const trend = (() => {
      const prev = s.network_observation_latest;
      const prevInvalid = typeof prev?.invalid === 'number' ? prev.invalid : null;
      const prevTs = prev?.ts || null;
      if (prevInvalid == null) return 'unknown';
      if (prevInvalid < (i + q)) return 'increasing';
      if (prevInvalid > (i + q)) return 'decreasing';
      return 'stable';
    })();

    lines.push('Details:');
    lines.push(`- top_invalid_peers: ${i}`);
    lines.push(`- quarantined: ${q}`);
    lines.push(`- trend: ${trend}`);

    // Version distribution (best-effort)
    const dist = new Map();
    for (const p of gpAll) {
      const vv = String(p?.node_version || p?.version || '').trim() || 'unknown';
      dist.set(vv, (dist.get(vv) || 0) + 1);
    }
    const entries = Array.from(dist.entries()).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    lines.push('');
    lines.push('Version Distribution:');
    for (const [vv, c] of entries.slice(0, 8)) {
      lines.push(`- ${vv}: ${c}`);
    }
  } catch {}

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
  const gp = Array.isArray(s.gossip_peers) ? s.gossip_peers : [];

  const trustScore = (s2) => (s2 === 'VERIFIED' ? 2 : s2 === 'UNVERIFIED' || !s2 ? 1 : s2 === 'INVALID' ? 0 : s2 === 'QUARANTINED' ? -1 : 1);
  const fmtPeerLine = (p, { hint = null } = {}) => {
    const sec = typeof p.age_ms === 'number' ? Math.round(p.age_ms / 1000) : null;
    const ag = p.agent_id ? String(p.agent_id) : null;
    const st = String(p.trust_state || p.trust_level || 'UNVERIFIED');
    const score = typeof p.trust_score === 'number' ? p.trust_score : trustScore(st);
    const bits = [`- ${p.node_id}`, `${sec ?? '?'}s ago`];
    if (ag) bits.push(ag);
    if (hint) bits.push(hint);
    bits.push(`trust_score: ${score}`);
    return bits.join(' — ');
  };

  const stateOf = (p) => String(p?.trust_state || p?.trust_level || 'UNVERIFIED');

  const verifiedPeers = gp.filter((p) => stateOf(p) === 'VERIFIED').sort((a, b) => (a.age_ms ?? 1e18) - (b.age_ms ?? 1e18));
  const unverifiedPeers = gp.filter((p) => stateOf(p) === 'UNVERIFIED').sort((a, b) => (a.age_ms ?? 1e18) - (b.age_ms ?? 1e18));
  const invalidPeers = gp.filter((p) => stateOf(p) === 'INVALID').sort((a, b) => (a.age_ms ?? 1e18) - (b.age_ms ?? 1e18));
  const quarantinedPeers = gp.filter((p) => stateOf(p) === 'QUARANTINED').sort((a, b) => (a.age_ms ?? 1e18) - (b.age_ms ?? 1e18));

  lines.push('🟢 VERIFIED (trusted)');
  if (!verifiedPeers.length) lines.push('- (none)');
  else for (const p of verifiedPeers.slice(0, 8)) lines.push(fmtPeerLine(p));

  lines.push('');
  lines.push('⚪ UNVERIFIED (unknown)');
  if (!unverifiedPeers.length) lines.push('- (none)');
  else for (const p of unverifiedPeers.slice(0, 8)) lines.push(fmtPeerLine(p, { hint: 'no signature' }));

  lines.push('');
  lines.push('🔴 INVALID (suspicious)');
  if (!invalidPeers.length) lines.push('- (none)');
  else for (const p of invalidPeers.slice(0, 8)) lines.push(fmtPeerLine(p, { hint: 'signature mismatch' }));

  lines.push('');
  lines.push('🟣 QUARANTINED (avoid)');
  if (!quarantinedPeers.length) lines.push('- (none)');
  else for (const p of quarantinedPeers.slice(0, 8)) lines.push(fmtPeerLine(p, { hint: 'quarantined' }));

  lines.push('');
  lines.push('👋 Welcome signals:');
  const wsigs = Array.isArray(s.welcome_signals) ? s.welcome_signals : [];
  if (!wsigs.length) {
    lines.push('- (no welcome yet)');
  } else {
    for (const w of wsigs.slice(0, 5)) {
      const sec = typeof w.age_ms === 'number' ? Math.round(w.age_ms / 1000) : null;
      lines.push(`- ${w.from} noticed you — ${sec ?? '?'}s ago`);
    }
  }

  lines.push('');
  lines.push('You are:');
  lines.push(`- node_id: ${s.self?.node_id || 'unknown (node not initialized)'}`);
  if (s.self?.agent_id) lines.push(`- agent_id: ${s.self.agent_id}`);
  if (s.self?.trust_level) lines.push(`- trust_status: ${s.self.trust_level}`);
  if (typeof s.self?.trust_score === 'number') lines.push(`- trust_score: ${s.self.trust_score}`);
  if (s.self?.current_version) lines.push(`- current_version: ${s.self.current_version}`);
  if (s.self?.target_version) lines.push(`- target_version: ${s.self.target_version}`);
  if (s.self?.upgrade_state) lines.push(`- upgrade_state: ${s.self.upgrade_state}`);

  const cc = s.self?.country_code;
  if (cc && /^[A-Z]{2}$/.test(String(cc))) {
    lines.push(`- location: ${flagFromCc(cc)} ${countryNameFromCc(cc)}`);
  }

  // Release security (v0.3.3 signed releases)
  if (s.self?.release_signature_status || s.self?.release_source) {
    lines.push('');
    lines.push('Release Security:');
    if (s.self?.release_signature_status) lines.push(`- signature: ${s.self.release_signature_status}`);
    if (s.self?.release_source) lines.push(`- source: ${s.self.release_source}`);
  }

  return lines.join('\n');
}
