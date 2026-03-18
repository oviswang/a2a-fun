import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  // machine-safe, stable JSON
  res.end(JSON.stringify(obj));
}

function nowIso() {
  return new Date().toISOString();
}

function readBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > maxBytes) {
        reject(Object.assign(new Error('request too large'), { code: 'REQ_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function safeError(code, reason) {
  return { ok: false, error: { code, reason } };
}

function cryptoRandom() {
  // deterministic not required; only for temp filename uniqueness
  return Math.random().toString(16).slice(2);
}

async function atomicWriteJson(filePath, obj) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${cryptoRandom()}`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, filePath);
}

async function readRegistry(filePath) {
  try {
    const txt = await fs.readFile(filePath, 'utf8');
    const j = JSON.parse(txt);
    const nodes = (j && typeof j.nodes === 'object' && j.nodes) || {};
    return {
      ok: true,
      version: j?.version || 'registry.v0.1',
      updated_at: j?.updated_at || null,
      nodes
    };
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return { ok: true, version: 'registry.v0.1', updated_at: null, nodes: {} };
    }
    throw e;
  }
}

function isNonEmptyString(x, { max = 200 } = {}) {
  return typeof x === 'string' && x.trim().length > 0 && x.trim().length <= max;
}

function normalizeStringArray(arr, { maxItems = 20, maxLen = 300 } = {}) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const it of arr) {
    if (!isNonEmptyString(it, { max: maxLen })) continue;
    out.push(String(it).trim());
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeObservedAddrs(x) {
  // Accept either strings or objects; store as-is but bounded.
  // IMPORTANT: keep this stable and small; bootstrap is the “truth source”.
  if (!Array.isArray(x)) return [];
  const out = [];
  for (const it of x) {
    if (typeof it === 'string') {
      const s = it.trim();
      if (!s || s.length > 300) continue;
      out.push(s);
    } else if (it && typeof it === 'object') {
      // allow a small subset of fields for stability
      const o = {};
      if (isNonEmptyString(it.public_ip, { max: 80 })) o.public_ip = String(it.public_ip).trim();
      if (isNonEmptyString(it.local_ip, { max: 80 })) o.local_ip = String(it.local_ip).trim();
      if (isNonEmptyString(it.region, { max: 80 })) o.region = String(it.region).trim();
      // geo-derived fields (server-side preferred)
      if (isNonEmptyString(it.country_code, { max: 2 })) o.country_code = String(it.country_code).trim().toUpperCase();
      if (isNonEmptyString(it.country_name, { max: 80 })) o.country_name = String(it.country_name).trim();
      if (isNonEmptyString(it.source, { max: 40 })) o.source = String(it.source).trim();
      if (Object.keys(o).length > 0) out.push(o);
    }
    if (out.length >= 20) break;
  }
  return out;
}

function normalizeIpLike(x) {
  if (!isNonEmptyString(x, { max: 120 })) return null;
  let s = String(x).trim();
  // x-forwarded-for may contain a list
  if (s.includes(',')) s = s.split(',')[0].trim();
  // strip port
  if (s.includes(':') && !s.includes('::')) {
    // might be ipv6; handle ipv4:port only
    const m = s.match(/^([0-9.]+):\d+$/);
    if (m) s = m[1];
  }
  if (s.startsWith('::ffff:')) s = s.slice('::ffff:'.length);
  return s || null;
}

function getForwardedPublicIp(req) {
  // Prefer proxy truth when available.
  // Caddy commonly sets X-Forwarded-For; Cloudflare sets CF-Connecting-IP.
  const h = req?.headers || {};
  return (
    normalizeIpLike(h['cf-connecting-ip']) ||
    normalizeIpLike(h['x-forwarded-for']) ||
    normalizeIpLike(h['x-real-ip']) ||
    normalizeIpLike(req?.socket?.remoteAddress)
  );
}

function getForwardedCountryCode(req) {
  const h = req?.headers || {};
  const cc = String(h['cf-ipcountry'] || h['x-country-code'] || '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(cc)) return cc;
  return null;
}

// Lightweight server-side GeoIP (best-effort) for authoritative bootstrap country_code.
// - Do NOT rely on client guessing.
// - Cache by IP to avoid repeated external calls.
const GEOIP_CACHE_PATH = process.env.BOOTSTRAP_GEOIP_CACHE_FILE || 'data/bootstrap-geoip-cache.json';
let _geoipCacheLoaded = false;
let _geoipByIp = {}; // ip -> { cc, updated_at }

async function loadGeoipCacheOnce() {
  if (_geoipCacheLoaded) return;
  _geoipCacheLoaded = true;
  try {
    const raw = await fs.readFile(GEOIP_CACHE_PATH, 'utf8');
    const j = JSON.parse(String(raw || '{}'));
    if (j && typeof j === 'object' && j.ips && typeof j.ips === 'object') _geoipByIp = j.ips;
  } catch {}
}

async function saveGeoipCache() {
  try {
    await fs.mkdir(path.dirname(GEOIP_CACHE_PATH), { recursive: true });
    const out = { ok: true, updated_at: nowIso(), ips: _geoipByIp };
    await fs.writeFile(GEOIP_CACHE_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
  } catch {}
}

async function fetchCountryCodeFromIp(ip, { timeoutMs = 350 } = {}) {
  // ipwho.is: lightweight, no key required (best-effort). Returns JSON.
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal: ac.signal });
    const j = await r.json().catch(() => null);
    const cc = j?.country_code ? String(j.country_code).trim().toUpperCase() : '';
    if (/^[A-Z]{2}$/.test(cc)) return cc;
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function resolveCountryCodeServerSide({ ip, headerCc } = {}) {
  const cc0 = headerCc && /^[A-Z]{2}$/.test(String(headerCc)) ? String(headerCc).toUpperCase() : null;
  if (cc0) return cc0;
  if (!ip) return null;

  await loadGeoipCacheOnce();
  const hit = _geoipByIp[ip];
  const cc1 = hit?.cc && /^[A-Z]{2}$/.test(String(hit.cc)) ? String(hit.cc).toUpperCase() : null;
  if (cc1) return cc1;

  const cc2 = await fetchCountryCodeFromIp(ip, { timeoutMs: 350 });
  if (cc2) {
    _geoipByIp[ip] = { cc: cc2, updated_at: nowIso() };
    void saveGeoipCache();
  }
  return cc2;
}

function parseIso(x) {
  try {
    const d = new Date(String(x));
    const t = d.getTime();
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

function computeStats(nodesById, { activeTimeoutMs, nowMs }) {
  const activeCutoff = nowMs - activeTimeoutMs;
  const dayCutoff = nowMs - 24 * 60 * 60 * 1000;

  let connected_nodes = 0;
  let active_agents_last_24h = 0;
  const regions = {};

  for (const node_id of Object.keys(nodesById)) {
    const n = nodesById[node_id];
    const lastSeenMs = parseIso(n?.last_seen) ?? null;
    if (!lastSeenMs) continue;

    if (lastSeenMs >= dayCutoff) active_agents_last_24h++;

    if (lastSeenMs >= activeCutoff) {
      connected_nodes++;
      // region aggregation (best-effort)
      let region = 'unknown';
      const addrs = Array.isArray(n?.observed_addrs) ? n.observed_addrs : [];
      for (const a of addrs) {
        if (a && typeof a === 'object' && isNonEmptyString(a.region, { max: 80 })) {
          region = String(a.region).trim();
          break;
        }
      }
      regions[region] = (regions[region] || 0) + 1;
    }
  }

  return { connected_nodes, active_agents_last_24h, regions };
}

export function createBootstrapServer({
  bindHost = '127.0.0.1',
  port = 3100,
  registryFile = 'data/bootstrap-registry.json',
  relays = []
} = {}) {
  const ACTIVE_TIMEOUT_MS = Number(process.env.BOOTSTRAP_ACTIVE_TIMEOUT_MS || 10 * 60 * 1000); // 10 minutes

  const relaysConfigured = normalizeStringArray(relays, { maxItems: 30, maxLen: 300 });

  const server = http.createServer(async (req, res) => {
    try {
      // health
      if (req.method === 'GET' && req.url === '/healthz') {
        return json(res, 200, { ok: true, service: 'a2a-bootstrap', protocol: 'a2a/0.1' });
      }

      // POST /publish-self
      if (req.method === 'POST' && req.url === '/publish-self') {
        const raw = await readBody(req);
        let body;
        try {
          body = JSON.parse(raw || '{}');
        } catch {
          return json(res, 400, safeError('BAD_JSON', 'invalid JSON'));
        }

        const node_id = String(body?.node_id || '').trim();
        if (!isNonEmptyString(node_id, { max: 120 })) {
          return json(res, 400, safeError('INVALID_NODE_ID', 'node_id required'));
        }

        const version = isNonEmptyString(body?.version, { max: 80 }) ? String(body.version).trim() : null;
        const capabilities = body?.capabilities && typeof body.capabilities === 'object' ? body.capabilities : {};
        const relay_urls = normalizeStringArray(body?.relay_urls, { maxItems: 20, maxLen: 300 });

        // Geo-aware: do NOT rely on node-side guessing only.
        // If node did not send observed_addrs, derive from proxy/server truth.
        const observed_addrs_client = normalizeObservedAddrs(body?.observed_addrs);
        const ip0 = getForwardedPublicIp(req);
        const cc0_header = getForwardedCountryCode(req);
        const cc0 = await resolveCountryCodeServerSide({ ip: ip0, headerCc: cc0_header });

        let observed_addrs = observed_addrs_client;
        if ((!observed_addrs || observed_addrs.length === 0) && ip0) {
          observed_addrs = normalizeObservedAddrs([
            {
              public_ip: ip0,
              country_code: cc0 || undefined,
              // keep region as a soft fallback for older tooling
              region: cc0 || 'unknown',
              source: 'bootstrap_derived'
            }
          ]);
        } else if (observed_addrs && observed_addrs.length > 0 && cc0) {
          // If client provided IP but not country, enrich the first addr object.
          const first = observed_addrs[0];
          if (first && typeof first === 'object' && !first.country_code) {
            first.country_code = cc0;
            if (!first.region) first.region = cc0;
            if (!first.source) first.source = 'bootstrap_enriched';
          }
        }

        const ts = isNonEmptyString(body?.ts, { max: 80 }) ? String(body.ts).trim() : nowIso();
        const last_seen = nowIso();

        const reg = await readRegistry(registryFile);
        const prev = reg.nodes[node_id] && typeof reg.nodes[node_id] === 'object' ? reg.nodes[node_id] : {};

        const nextNode = {
          node_id,
          version: version ?? prev.version ?? null,
          capabilities: capabilities ?? prev.capabilities ?? {},
          relay_urls: relay_urls.length > 0 ? relay_urls : prev.relay_urls ?? [],
          observed_addrs: observed_addrs.length > 0 ? observed_addrs : prev.observed_addrs ?? [],
          country_code: cc0 || prev.country_code || null,
          ts,
          last_seen
        };

        const next = {
          ok: true,
          version: 'registry.v0.1',
          updated_at: nowIso(),
          nodes: {
            ...reg.nodes,
            [node_id]: nextNode
          }
        };

        try {
          await atomicWriteJson(registryFile, next);
        } catch {
          return json(res, 500, safeError('PERSIST_FAIL', 'failed to persist registry'));
        }

        return json(res, 200, { ok: true, registered: true, node_id, last_seen });
      }

      // POST /heartbeat
      if (req.method === 'POST' && req.url === '/heartbeat') {
        const raw = await readBody(req);
        let body;
        try {
          body = JSON.parse(raw || '{}');
        } catch {
          return json(res, 400, safeError('BAD_JSON', 'invalid JSON'));
        }

        const node_id = String(body?.node_id || '').trim();
        if (!isNonEmptyString(node_id, { max: 120 })) {
          return json(res, 400, safeError('INVALID_NODE_ID', 'node_id required'));
        }

        const reg = await readRegistry(registryFile);
        const prev = reg.nodes[node_id];
        if (!prev) {
          return json(res, 404, safeError('UNKNOWN_NODE', 'node_id not registered'));
        }

        const last_seen = nowIso();

        // Best-effort enrichment on heartbeat too (some nodes may miss publish-self refresh).
        const ip0 = getForwardedPublicIp(req);
        const cc0_header = getForwardedCountryCode(req);
        const cc0 = await resolveCountryCodeServerSide({ ip: ip0, headerCc: cc0_header });

        let observed_addrs = Array.isArray(prev?.observed_addrs) ? prev.observed_addrs : [];
        if ((!observed_addrs || observed_addrs.length === 0) && ip0) {
          observed_addrs = normalizeObservedAddrs([
            {
              public_ip: ip0,
              country_code: cc0 || undefined,
              region: cc0 || 'unknown',
              source: 'bootstrap_heartbeat'
            }
          ]);
        }

        const next = {
          ok: true,
          version: 'registry.v0.1',
          updated_at: nowIso(),
          nodes: {
            ...reg.nodes,
            [node_id]: {
              ...prev,
              country_code: cc0 || prev.country_code || null,
              observed_addrs,
              last_seen
            }
          }
        };

        try {
          await atomicWriteJson(registryFile, next);
        } catch {
          return json(res, 500, safeError('PERSIST_FAIL', 'failed to persist registry'));
        }

        return json(res, 200, { ok: true, node_id, last_seen });
      }

      // GET /peers
      if (req.method === 'GET' && req.url === '/peers') {
        const reg = await readRegistry(registryFile);
        const nowMs = Date.now();
        const cutoff = nowMs - ACTIVE_TIMEOUT_MS;

        const peers = [];
        for (const node_id of Object.keys(reg.nodes || {})) {
          const n = reg.nodes[node_id];
          const lastSeenMs = parseIso(n?.last_seen) ?? null;
          if (!lastSeenMs || lastSeenMs < cutoff) continue; // expired

          peers.push({
            node_id: n.node_id,
            version: n.version ?? null,
            country_code: n.country_code ?? null,
            relay_urls: Array.isArray(n.relay_urls) ? n.relay_urls : [],
            observed_addrs: Array.isArray(n.observed_addrs) ? n.observed_addrs : [],
            last_seen: n.last_seen,
            capabilities: n.capabilities ?? {}
          });
        }

        peers.sort((a, b) => String(a.node_id).localeCompare(String(b.node_id)));
        return json(res, 200, {
          ok: true,
          protocol: 'a2a/0.1',
          active_timeout_ms: ACTIVE_TIMEOUT_MS,
          peers
        });
      }

      // GET /relays
      if (req.method === 'GET' && req.url === '/relays') {
        return json(res, 200, {
          ok: true,
          protocol: 'a2a/0.1',
          relays: relaysConfigured
        });
      }

      // GET /network_stats (must never 404 once implemented)
      if (req.method === 'GET' && req.url === '/network_stats') {
        const reg = await readRegistry(registryFile);
        const stats = computeStats(reg.nodes || {}, { activeTimeoutMs: ACTIVE_TIMEOUT_MS, nowMs: Date.now() });
        return json(res, 200, {
          ok: true,
          protocol: 'a2a/0.1',
          ts: nowIso(),
          connected_nodes: stats.connected_nodes,
          active_agents_last_24h: stats.active_agents_last_24h,
          regions: stats.regions
        });
      }

      return json(res, 404, safeError('NOT_FOUND', 'unknown endpoint'));
    } catch (e) {
      // Fail closed, machine-safe.
      const code = e?.code || 'INTERNAL';
      return json(res, 500, safeError(code, 'internal error'));
    }
  });

  let boundAddress = null;

  return {
    start: async () =>
      new Promise((resolve) =>
        server.listen(port, bindHost, () => {
          boundAddress = server.address();
          resolve();
        })
      ),
    address: () => boundAddress,
    close: async () => new Promise((resolve) => server.close(() => resolve()))
  };
}
