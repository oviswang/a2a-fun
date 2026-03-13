import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { decideTransport } from '../src/runtime/transport/decideTransport.mjs';

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    close: async () => new Promise((resolve) => server.close(() => resolve()))
  };
}

test('decision: direct reachable -> choose direct', async () => {
  const srv = await startServer((req, res) => {
    res.statusCode = 200;
    res.end('ok');
  });
  try {
    const out = await decideTransport({ peerUrl: srv.url, timeoutMs: 500, relayAvailable: true });
    assert.equal(out.transport, 'direct');
    assert.equal(out.directReachable, true);
    assert.equal(out.relayAvailable, true);
    assert.equal(out.reason, null);
    assert.equal(out.status, 200);
  } finally {
    await srv.close();
  }
});

test('decision: direct unreachable + relay available -> choose relay', async () => {
  const srv = await startServer((req, res) => res.end('x'));
  const url = srv.url;
  await srv.close();

  const out = await decideTransport({ peerUrl: url, timeoutMs: 300, relayAvailable: true });
  assert.equal(out.transport, 'relay');
  assert.equal(out.directReachable, false);
  assert.equal(out.relayAvailable, true);
  assert.equal(out.reason, 'UNREACHABLE');
  assert.equal(out.status, null);
});

test('decision: direct unreachable + relay unavailable -> fail closed', async () => {
  const srv = await startServer((req, res) => res.end('x'));
  const url = srv.url;
  await srv.close();

  await assert.rejects(
    () => decideTransport({ peerUrl: url, timeoutMs: 300, relayAvailable: false }),
    (e) => e && e.code === 'NO_USABLE_TRANSPORT'
  );
});

test('decision: timeout + relay available -> choose relay', async () => {
  const srv = await startServer((req, res) => {
    void req;
    void res;
  });
  try {
    const out = await decideTransport({ peerUrl: srv.url, timeoutMs: 30, relayAvailable: true });
    assert.equal(out.transport, 'relay');
    assert.equal(out.directReachable, false);
    assert.equal(out.reason, 'TIMEOUT');
  } finally {
    await srv.close();
  }
});

test('decision: deterministic output shape', async () => {
  const srv = await startServer((req, res) => {
    res.statusCode = 404;
    res.end('not found');
  });
  try {
    const a = await decideTransport({ peerUrl: srv.url, timeoutMs: 500, relayAvailable: true });
    const b = await decideTransport({ peerUrl: srv.url, timeoutMs: 500, relayAvailable: true });
    assert.deepEqual(Object.keys(a), Object.keys(b));
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.notEqual(a.transport, 'mailbox');
  } finally {
    await srv.close();
  }
});
