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
      if (Object.keys(o).length > 0) out.push(o);
    }
    if (out.length >= 20) break;
  }
  return out;
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
        const observed_addrs = normalizeObservedAddrs(body?.observed_addrs);

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
        const next = {
          ok: true,
          version: 'registry.v0.1',
          updated_at: nowIso(),
          nodes: {
            ...reg.nodes,
            [node_id]: {
              ...prev,
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
