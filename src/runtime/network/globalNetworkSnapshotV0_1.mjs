import fs from 'node:fs/promises';
import path from 'node:path';

function nowIso() {
  return new Date().toISOString();
}

function workspacePath() {
  const p = process.env.A2A_WORKSPACE_PATH;
  if (p && String(p).trim()) return String(p).trim();
  return process.cwd();
}

async function readJsonFileSafe(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJsonAtomic(p, obj) {
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${p}.tmp.${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2));
  await fs.rename(tmp, p);
}

function flagFromCc(cc) {
  const c = String(cc || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  const A = 0x1f1e6;
  const a = 'A'.charCodeAt(0);
  return String.fromCodePoint(A + (c.charCodeAt(0) - a), A + (c.charCodeAt(1) - a));
}

function normalizePeerList(j) {
  if (!j || typeof j !== 'object') return [];

  // Common shapes:
  // - { ok:true, peers:[...] }
  // - { ok:true, agents:[...] }
  // - { ok:true, nodes:{ id: {...} } }
  // - { peers:[...] } (local peers.json)

  if (Array.isArray(j.peers)) return j.peers;
  if (Array.isArray(j.agents)) return j.agents;

  if (j.nodes && typeof j.nodes === 'object') {
    const out = [];
    for (const k of Object.keys(j.nodes)) {
      const n = j.nodes[k];
      if (n && typeof n === 'object') out.push(n);
    }
    return out;
  }

  return [];
}

function pickPublicIp(peer) {
  const addrs = Array.isArray(peer?.observed_addrs) ? peer.observed_addrs : [];
  for (const a of addrs) {
    const ip = a?.public_ip;
    if (typeof ip === 'string' && ip.trim()) return ip.trim();
  }
  // some payloads may embed ip differently
  if (typeof peer?.public_ip === 'string' && peer.public_ip.trim()) return peer.public_ip.trim();
  return null;
}

function pickCountryCode(peer) {
  const addrs = Array.isArray(peer?.observed_addrs) ? peer.observed_addrs : [];
  for (const a of addrs) {
    if (!a || typeof a !== 'object') continue;
    const cc = a.country_code ? String(a.country_code).trim().toUpperCase() : '';
    if (/^[A-Z]{2}$/.test(cc)) return cc;

    // Back-compat: some systems may stash cc in region
    const r = a.region ? String(a.region).trim().toUpperCase() : '';
    if (/^[A-Z]{2}$/.test(r)) return r;
  }
  return null;
}

function countryNameFromCc(cc) {
  const c = String(cc || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  try {
    // Node builtin; no external dependency.
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    return dn.of(c) || c;
  } catch {
    return c;
  }
}

async function fetchJsonWithTimeout(url, { timeoutMs = 800 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'GET', signal: ac.signal });
    const text = await r.text();
    let j = null;
    try {
      j = JSON.parse(text);
    } catch {
      j = null;
    }
    return { ok: r.ok, status: r.status, json: j, text };
  } catch (e) {
    return { ok: false, status: 0, json: null, error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

async function geoLookupIp(ip, { timeoutMs = 350 } = {}) {
  // ipapi.co: no key, returns JSON. Best-effort.
  const url = `https://ipapi.co/${encodeURIComponent(ip)}/json/`;
  const out = await fetchJsonWithTimeout(url, { timeoutMs });
  const cc = out?.json?.country_code ? String(out.json.country_code).toUpperCase() : null;
  const name = out?.json?.country_name ? String(out.json.country_name) : null;
  if (cc && /^[A-Z]{2}$/.test(cc)) return { ok: true, cc, name: name || cc };
  return { ok: false };
}

async function mapWithConcurrency(items, limit, fn, { budgetMs = 1200 } = {}) {
  const started = Date.now();
  const out = new Array(items.length);
  let i = 0;

  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      if (Date.now() - started > budgetMs) {
        out[idx] = null;
        continue;
      }
      try {
        out[idx] = await fn(items[idx], idx);
      } catch {
        out[idx] = null;
      }
    }
  });

  await Promise.race([
    Promise.all(workers),
    new Promise((r) => setTimeout(r, Math.max(0, budgetMs - (Date.now() - started))))
  ]);

  return out;
}

export async function buildGlobalNetworkSnapshotV0_1({
  selfNodeId = null,
  remoteAgentsUrl = 'https://bootstrap.a2a.fun/agents',
  remotePeersUrl = 'https://bootstrap.a2a.fun/peers',
  maxNodesForGeo = 60
} = {}) {
  const ws = workspacePath();
  const peersPath = path.join(ws, 'data', 'peers.json');

  // 1) data source (remote preferred)
  let peers = [];
  let data_source_used = null;

  const r1 = await fetchJsonWithTimeout(remoteAgentsUrl, { timeoutMs: 800 });
  const p1 = normalizePeerList(r1.json);
  if (r1.ok && p1.length >= 0 && (Array.isArray(r1.json?.agents) || Array.isArray(r1.json?.peers) || r1.json?.nodes)) {
    peers = p1;
    data_source_used = remoteAgentsUrl;
  } else {
    // try /peers as a compatibility fallback (still remote + fast)
    const r2 = await fetchJsonWithTimeout(remotePeersUrl, { timeoutMs: 800 });
    const p2 = normalizePeerList(r2.json);
    if (r2.ok && Array.isArray(r2.json?.peers)) {
      peers = p2;
      data_source_used = remotePeersUrl;
    } else {
      const local = await readJsonFileSafe(peersPath);
      peers = normalizePeerList(local);
      data_source_used = peersPath;
    }
  }

  // normalize basic fields
  const nodes = peers
    .map((p) => {
      const node_id = String(p?.node_id || p?.id || '').trim();
      if (!node_id) return null;
      return {
        node_id,
        observed_addrs: Array.isArray(p?.observed_addrs) ? p.observed_addrs : [],
        relay_urls: Array.isArray(p?.relay_urls) ? p.relay_urls : [],
        last_seen: p?.last_seen || null
      };
    })
    .filter(Boolean);

  // 2) count total nodes
  const total_nodes = nodes.length;

  // 3) determine self
  const selfId = String(
    selfNodeId || process.env.NODE_ID || process.env.A2A_AGENT_ID || ''
  ).trim();

  const sortedNodeIds = [...new Set(nodes.map((n) => n.node_id))].sort((a, b) => a.localeCompare(b));
  const selfIndex = selfId ? sortedNodeIds.indexOf(selfId) : -1;

  // 4) geo lookup (best-effort + cached)
  const cachePath = path.join(ws, 'data', 'geoip-cache.json');
  const cache0 = (await readJsonFileSafe(cachePath)) || { ok: true, updated_at: null, ips: {} };
  const cacheIps = cache0 && typeof cache0.ips === 'object' ? cache0.ips : {};

  const ips = [];
  const ipToNodes = new Map();

  for (const n of nodes) {
    const ip = pickPublicIp(n);
    if (!ip) continue;
    if (!ipToNodes.has(ip)) {
      ips.push(ip);
      ipToNodes.set(ip, []);
    }
    ipToNodes.get(ip).push(n.node_id);
  }

  const uniqueIps = ips.slice(0, Math.max(0, maxNodesForGeo));

  const toLookup = [];
  for (const ip of uniqueIps) {
    const hit = cacheIps[ip];
    if (hit && typeof hit === 'object' && hit.cc && /^[A-Z]{2}$/.test(String(hit.cc))) continue;
    toLookup.push(ip);
  }

  // Do quick geo lookups in parallel, time-bounded.
  const results = await mapWithConcurrency(
    toLookup,
    12,
    async (ip) => {
      const r = await geoLookupIp(ip, { timeoutMs: 350 });
      if (r.ok) return { ip, cc: r.cc, name: r.name || r.cc };
      return { ip, cc: null, name: null };
    },
    { budgetMs: 1200 }
  );

  let cacheChanged = false;
  for (const r of results) {
    if (!r || !r.ip) continue;
    if (r.cc) {
      cacheIps[r.ip] = { cc: r.cc, name: r.name || r.cc, updated_at: nowIso() };
      cacheChanged = true;
    } else {
      // keep prior cache if any; otherwise mark as unknown
      if (!cacheIps[r.ip]) {
        cacheIps[r.ip] = { cc: null, name: null, updated_at: nowIso() };
        cacheChanged = true;
      }
    }
  }

  if (cacheChanged) {
    await writeJsonAtomic(cachePath, { ok: true, updated_at: nowIso(), ips: cacheIps }).catch(() => {});
  }

  const byCountry = new Map();
  for (const n of nodes) {
    // Preferred: server-side truth embedded into observed_addrs.country_code
    const ccObs = pickCountryCode(n);
    if (ccObs) {
      byCountry.set(ccObs, (byCountry.get(ccObs) || 0) + 1);
      continue;
    }

    // Fallback: client-provided IP → best-effort lookup + cache
    const ip = pickPublicIp(n);
    const hit = ip ? cacheIps[ip] : null;
    const cc = hit && hit.cc && /^[A-Z]{2}$/.test(String(hit.cc)) ? String(hit.cc).toUpperCase() : 'unknown';
    byCountry.set(cc, (byCountry.get(cc) || 0) + 1);
  }

  const regions = [...byCountry.entries()]
    .map(([cc, count]) => ({ cc, name: cc === 'unknown' ? 'Unknown' : (countryNameFromCc(cc) || cc), count }))
    .sort((a, b) => b.count - a.count || String(a.cc).localeCompare(String(b.cc)));

  // self location
  let selfLocation = { cc: 'unknown', name: 'Unknown', flag: '🌍' };
  if (selfId) {
    const selfNode = nodes.find((n) => n.node_id === selfId) || null;

    const ccObs = selfNode ? pickCountryCode(selfNode) : null;
    if (ccObs) {
      selfLocation = { cc: ccObs, name: countryNameFromCc(ccObs) || ccObs, flag: flagFromCc(ccObs) || '🌍' };
    } else {
      const selfIp = selfNode ? pickPublicIp(selfNode) : null;
      const hit = selfIp ? cacheIps[selfIp] : null;
      const cc = hit && hit.cc ? String(hit.cc).toUpperCase() : null;
      const name = hit && hit.name ? String(hit.name) : null;
      if (cc && /^[A-Z]{2}$/.test(cc)) {
        selfLocation = { cc, name: name || countryNameFromCc(cc) || cc, flag: flagFromCc(cc) || '🌍' };
      }
    }
  }

  return {
    ok: true,
    version: 'A2A_GLOBAL_NETWORK_SNAPSHOT_V0_1',
    ts: nowIso(),
    data_source_used,
    total_nodes,
    top_regions: regions,
    self: {
      node_id: selfId || null,
      index_1based: selfIndex >= 0 ? selfIndex + 1 : null,
      total_sorted: sortedNodeIds.length,
      location: selfLocation
    }
  };
}

export function formatGlobalNetworkSnapshotV0_1(snapshot, { topN = 8 } = {}) {
  const s = snapshot || {};
  const lines = [];
  lines.push('🌐 A2A NETWORK ONLINE');
  lines.push('');
  lines.push(`Total nodes: ${typeof s.total_nodes === 'number' ? s.total_nodes : 'unknown'}`);
  lines.push('');

  const regions = Array.isArray(s.top_regions) ? s.top_regions : [];
  if (regions.length) {
    for (const r of regions.slice(0, Math.max(1, topN))) {
      const cc = r.cc || 'unknown';
      const flag = cc !== 'unknown' ? (flagFromCc(cc) || '🌍') : '🌍';
      const name = r.name || (cc === 'unknown' ? 'Unknown' : cc);
      lines.push(`${flag} ${name}: ${r.count}`);
    }
  } else {
    lines.push('🌍 Unknown: 0');
  }

  lines.push('');
  if (s.self?.node_id) {
    const idx = s.self?.index_1based;
    const loc = s.self?.location;
    const locLine = loc?.cc && loc.cc !== 'unknown' ? `${loc.flag || '🌍'} ${loc.name || loc.cc}` : '🌍 Unknown';
    lines.push(`You are node #${idx || '?'}`);
    lines.push(`Your location: ${locLine}`);
  } else {
    lines.push('You are node #?');
    lines.push('Your location: 🌍 Unknown');
  }

  return lines.join('\n');
}
