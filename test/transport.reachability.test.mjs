import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { checkDirectReachability } from '../src/runtime/transport/checkDirectReachability.mjs';

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    close: async () => new Promise((resolve) => server.close(() => resolve()))
  };
}

test('reachability: reachable peer -> directReachable true', async () => {
  const srv = await startServer((req, res) => {
    res.statusCode = 200;
    res.end('ok');
  });

  try {
    const out = await checkDirectReachability({ peerUrl: srv.url, timeoutMs: 1000 });
    assert.equal(out.directReachable, true);
    assert.equal(out.status, 200);
  } finally {
    await srv.close();
  }
});

test('reachability: unreachable peer -> directReachable false', async () => {
  // Pick a port likely unused by binding then closing immediately.
  const srv = await startServer((req, res) => res.end('x'));
  const url = srv.url;
  await srv.close();

  const out = await checkDirectReachability({ peerUrl: url, timeoutMs: 500 });
  assert.deepEqual(out, { directReachable: false, reason: 'UNREACHABLE' });
});

test('reachability: timeout -> directReachable false with TIMEOUT reason', async () => {
  const srv = await startServer((req, res) => {
    // Intentionally never end.
    void req;
    void res;
  });

  try {
    const out = await checkDirectReachability({ peerUrl: srv.url, timeoutMs: 50 });
    assert.deepEqual(out, { directReachable: false, reason: 'TIMEOUT' });
  } finally {
    await srv.close();
  }
});

test('reachability: deterministic output shape', async () => {
  const srv = await startServer((req, res) => {
    res.statusCode = 404;
    res.end('not found');
  });

  try {
    const a = await checkDirectReachability({ peerUrl: srv.url, timeoutMs: 1000 });
    const b = await checkDirectReachability({ peerUrl: srv.url, timeoutMs: 1000 });
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
    assert.equal(typeof a.directReachable, 'boolean');
  } finally {
    await srv.close();
  }
});
