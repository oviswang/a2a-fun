function safeError(code, reason) {
  return { ok: false, error: { code, reason } };
}

function validateNodeUrl(raw) {
  if (typeof raw !== 'string') throw new Error('BootstrapClient: url must be string');
  const s = raw.trim();
  if (!s) throw new Error('BootstrapClient: url required');
  if (s.length > 256) throw new Error('BootstrapClient: url too long');

  const u = new URL(s);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('BootstrapClient: url must be http(s)');
  if (u.username || u.password) throw new Error('BootstrapClient: url must not include credentials');
  if (u.hash) throw new Error('BootstrapClient: url must not include fragment');

  u.search = '';
  return u.toString();
}

function assertPeersShape(peers) {
  if (!Array.isArray(peers)) throw new Error('BootstrapClient: peers must be array');
  for (const p of peers) {
    if (typeof p !== 'string') throw new Error('BootstrapClient: peers must be string[]');
    validateNodeUrl(p);
  }
}

export async function bootstrapJoin({ bootstrapUrl, selfNodeUrl, httpClient }) {
  if (!httpClient) throw new Error('BootstrapClient: missing httpClient');
  const b = validateNodeUrl(bootstrapUrl);
  const self = validateNodeUrl(selfNodeUrl);

  const r = await httpClient(`${b.replace(/\/$/, '')}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ node: self })
  });

  if (!r || typeof r.status !== 'number') throw new Error('BootstrapClient: httpClient invalid response');
  const json = await r.json();
  if (!json || json.ok !== true) {
    const err = new Error('BootstrapClient: join failed');
    err.meta = safeError('JOIN_FAIL', 'join failed');
    throw err;
  }

  return { ok: true };
}

export async function bootstrapGetPeers({ bootstrapUrl, httpClient }) {
  if (!httpClient) throw new Error('BootstrapClient: missing httpClient');
  const b = validateNodeUrl(bootstrapUrl);

  const r = await httpClient(`${b.replace(/\/$/, '')}/peers`, { method: 'GET' });
  if (!r || typeof r.status !== 'number') throw new Error('BootstrapClient: httpClient invalid response');
  const json = await r.json();
  if (!json || json.ok !== true) {
    const err = new Error('BootstrapClient: peers fetch failed');
    err.meta = safeError('PEERS_FAIL', 'peers fetch failed');
    throw err;
  }

  assertPeersShape(json.peers);

  return { ok: true, peers: json.peers.map(validateNodeUrl) };
}

export function createFetchHttpClient({ timeoutMs = 5000 } = {}) {
  return async function httpClient(url, opts = {}) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...opts, signal: ac.signal });
      return {
        status: r.status,
        ok: r.ok,
        async json() {
          return r.json();
        }
      };
    } finally {
      clearTimeout(t);
    }
  };
}

export const _internal = { validateNodeUrl, assertPeersShape };
