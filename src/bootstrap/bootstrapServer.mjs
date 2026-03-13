import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(obj));
}

function readBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > maxBytes) {
        reject(new Error('request too large'));
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

function validateNodeUrl(raw) {
  if (typeof raw !== 'string') throw Object.assign(new Error('node must be string'), { code: 'INVALID_NODE' });
  const s = raw.trim();
  if (!s) throw Object.assign(new Error('node required'), { code: 'MISSING_NODE' });
  if (s.length > 256) throw Object.assign(new Error('node too long'), { code: 'INVALID_NODE' });

  let u;
  try {
    u = new URL(s);
  } catch {
    throw Object.assign(new Error('node must be a valid URL'), { code: 'INVALID_NODE' });
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw Object.assign(new Error('node must be http(s)'), { code: 'INVALID_NODE' });
  }
  if (u.username || u.password) {
    throw Object.assign(new Error('node must not include credentials'), { code: 'INVALID_NODE' });
  }
  if (u.hash) {
    throw Object.assign(new Error('node must not include fragment'), { code: 'INVALID_NODE' });
  }

  // Normalize: keep origin + pathname only; drop search params.
  u.search = '';
  const normalized = u.toString();

  return normalized;
}

async function readPeersFile(filePath) {
  try {
    const txt = await fs.readFile(filePath, 'utf8');
    const j = JSON.parse(txt);
    const peers = Array.isArray(j?.peers) ? j.peers.filter((x) => typeof x === 'string') : [];
    return { peers };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { peers: [] };
    throw e;
  }
}

async function atomicWriteJson(filePath, obj) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${cryptoRandom()}`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, filePath);
}

function cryptoRandom() {
  // deterministic not required; only for temp filename uniqueness
  return Math.random().toString(16).slice(2);
}

export function createBootstrapServer({ bindHost = '127.0.0.1', port = 3100, dataFile = 'data/bootstrap-peers.json' } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/healthz') {
        return json(res, 200, { ok: true, service: 'a2a-bootstrap' });
      }

      if (req.method === 'GET' && req.url === '/peers') {
        const { peers } = await readPeersFile(dataFile);
        return json(res, 200, { ok: true, peers });
      }

      if (req.method === 'POST' && req.url === '/join') {
        const raw = await readBody(req);
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return json(res, 400, safeError('BAD_JSON', 'invalid JSON'));
        }

        let node;
        try {
          node = validateNodeUrl(body?.node);
        } catch (e) {
          const code = e?.code || 'INVALID_NODE';
          return json(res, 400, safeError(code, 'invalid node url'));
        }

        const { peers } = await readPeersFile(dataFile);
        const set = new Set(peers);
        set.add(node);
        const next = Array.from(set);
        next.sort();

        try {
          await atomicWriteJson(dataFile, { peers: next, updated_at: new Date().toISOString() });
        } catch {
          return json(res, 500, safeError('PERSIST_FAIL', 'failed to persist peers'));
        }

        return json(res, 200, { ok: true, joined: true, peers_count: next.length });
      }

      return json(res, 404, safeError('NOT_FOUND', 'unknown endpoint'));
    } catch {
      // Fail closed, machine-safe.
      return json(res, 500, safeError('INTERNAL', 'internal error'));
    }
  });

  return {
    start: async () => new Promise((resolve) => server.listen(port, bindHost, resolve)),
    close: async () => new Promise((resolve) => server.close(() => resolve()))
  };
}
