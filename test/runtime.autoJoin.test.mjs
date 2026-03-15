import test from 'node:test';
import assert from 'node:assert/strict';

import { runNodeAutoJoin } from '../src/runtime/bootstrap/nodeAutoJoin.mjs';

function makeHttpClient(routes) {
  return async (url, opts = {}) => {
    const key = `${opts.method || 'GET'} ${url}`;
    const h = routes[key];
    if (!h) throw new Error(`fetch failed: no route for ${key}`);
    if (h.throw) throw h.throw;
    return {
      status: h.status ?? 200,
      ok: (h.status ?? 200) >= 200 && (h.status ?? 200) < 300,
      async json() {
        return h.json;
      }
    };
  };
}

const primary = 'https://bootstrap.a2a.fun';
const fallback = 'https://bootstrap.a2a.fun';

const self = 'https://node.self.example.com';

function joinUrl(base) {
  return `${base}/join`;
}
function peersUrl(base) {
  return `${base}/peers`;
}

test('auto-join: primary bootstrap success', async () => {
  const httpClient = makeHttpClient({
    [`POST ${joinUrl(primary)}`]: { json: { ok: true } },
    [`GET ${peersUrl(primary)}`]: { json: { ok: true, peers: ['https://p1.example.com'] } }
  });

  const out = await runNodeAutoJoin({
    selfNodeUrl: self,
    bootstrapPrimary: primary,
    bootstrapFallback: fallback,
    maxPeers: 3,
    httpClient
  });

  assert.equal(out.ok, true);
  assert.equal(out.bootstrap_used, 'primary');
  assert.deepEqual(out.selected_peers, ['https://p1.example.com/']);
});

test.skip('auto-join: primary unreachable -> fallback success (single-bootstrap mode)', async () => {
  const httpClient = makeHttpClient({
    [`POST ${joinUrl(primary)}`]: { throw: new Error('fetch failed') },
    [`POST ${joinUrl(fallback)}`]: { json: { ok: true } },
    [`GET ${peersUrl(fallback)}`]: { json: { ok: true, peers: ['https://p2.example.com'] } }
  });

  const out = await runNodeAutoJoin({
    selfNodeUrl: self,
    bootstrapPrimary: primary,
    bootstrapFallback: fallback,
    maxPeers: 3,
    httpClient
  });

  assert.equal(out.ok, true);
  assert.equal(out.bootstrap_used, 'fallback');
});

test('auto-join: both bootstrap endpoints unreachable -> fail closed', async () => {
  const httpClient = makeHttpClient({
    [`POST ${joinUrl(primary)}`]: { throw: new Error('fetch failed') },
    [`POST ${joinUrl(fallback)}`]: { throw: new Error('fetch failed') }
  });

  await assert.rejects(
    () =>
      runNodeAutoJoin({
        selfNodeUrl: self,
        bootstrapPrimary: primary,
        bootstrapFallback: fallback,
        maxPeers: 3,
        httpClient
      }),
    /fetch failed/
  );
});

test('auto-join: join success + peers fetch success', async () => {
  const httpClient = makeHttpClient({
    [`POST ${joinUrl(primary)}`]: { json: { ok: true } },
    [`GET ${peersUrl(primary)}`]: { json: { ok: true, peers: ['https://p1.example.com', 'https://p2.example.com'] } }
  });

  const out = await runNodeAutoJoin({
    selfNodeUrl: self,
    bootstrapPrimary: primary,
    bootstrapFallback: fallback,
    maxPeers: 3,
    httpClient
  });

  assert.equal(out.peers_fetched, 2);
  assert.equal(out.selected_peers.length, 2);
});

test('auto-join: self URL excluded', async () => {
  const httpClient = makeHttpClient({
    [`POST ${joinUrl(primary)}`]: { json: { ok: true } },
    [`GET ${peersUrl(primary)}`]: { json: { ok: true, peers: [self, 'https://p2.example.com'] } }
  });

  const out = await runNodeAutoJoin({
    selfNodeUrl: self,
    bootstrapPrimary: primary,
    bootstrapFallback: fallback,
    maxPeers: 3,
    httpClient
  });

  assert.deepEqual(out.selected_peers, ['https://p2.example.com/']);
});

test('auto-join: deterministic peer selection with maxPeers limit', async () => {
  const httpClient = makeHttpClient({
    [`POST ${joinUrl(primary)}`]: { json: { ok: true } },
    [`GET ${peersUrl(primary)}`]: {
      json: {
        ok: true,
        peers: ['https://c.example.com', 'https://a.example.com', 'https://b.example.com', 'https://a.example.com']
      }
    }
  });

  const out = await runNodeAutoJoin({
    selfNodeUrl: self,
    bootstrapPrimary: primary,
    bootstrapFallback: fallback,
    maxPeers: 2,
    httpClient
  });

  // Dedupe + lexicographic sort + slice(0, maxPeers)
  assert.deepEqual(out.selected_peers, ['https://a.example.com/', 'https://b.example.com/']);
});

test('auto-join: invalid peer list -> fail closed', async () => {
  const httpClient = makeHttpClient({
    [`POST ${joinUrl(primary)}`]: { json: { ok: true } },
    [`GET ${peersUrl(primary)}`]: { json: { ok: true, peers: [123] } }
  });

  await assert.rejects(
    () =>
      runNodeAutoJoin({
        selfNodeUrl: self,
        bootstrapPrimary: primary,
        bootstrapFallback: fallback,
        maxPeers: 3,
        httpClient
      }),
    /peers must be string\[\]/
  );
});

test('auto-join: no friendship side-effects', async () => {
  const storage = {
    async writeFriends() {
      throw new Error('must not be called');
    }
  };

  const httpClient = makeHttpClient({
    [`POST ${joinUrl(primary)}`]: { json: { ok: true } },
    [`GET ${peersUrl(primary)}`]: { json: { ok: true, peers: ['https://p1.example.com'] } }
  });

  const out = await runNodeAutoJoin({
    selfNodeUrl: self,
    bootstrapPrimary: primary,
    bootstrapFallback: fallback,
    maxPeers: 3,
    storage,
    httpClient
  });

  assert.equal(out.ok, true);
});

test.skip('auto-join: primary reachable but business failure must NOT fallback (fail closed) (single-bootstrap mode)', async () => {
  const httpClient = makeHttpClient({
    // Primary reachable but returns ok:false
    [`POST ${joinUrl(primary)}`]: { json: { ok: false } },

    // Fallback routes exist but must not be used.
    [`POST ${joinUrl(fallback)}`]: { json: { ok: true } },
    [`GET ${peersUrl(fallback)}`]: { json: { ok: true, peers: ['https://p2.example.com'] } }
  });

  await assert.rejects(
    () =>
      runNodeAutoJoin({
        selfNodeUrl: self,
        bootstrapPrimary: primary,
        bootstrapFallback: fallback,
        maxPeers: 3,
        httpClient
      }),
    /join failed/
  );
});
