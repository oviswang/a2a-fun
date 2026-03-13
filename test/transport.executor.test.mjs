import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createRelayServer } from '../src/relay/relayServer.mjs';
import { executeTransport } from '../src/runtime/transport/executeTransport.mjs';

async function startHttpServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    close: async () => new Promise((resolve) => server.close(() => resolve()))
  };
}

function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, reject) =>
      setTimeout(() => {
        const e = new Error(`timeout: ${label}`);
        e.code = 'TEST_TIMEOUT';
        reject(e);
      }, ms)
    )
  ]);
}

function wsOpen(url) {
  return withTimeout(
    new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(ws), { once: true });
      ws.addEventListener('error', (e) => reject(e), { once: true });
    }),
    1000,
    'wsOpen'
  );
}

function wsNextMessage(ws) {
  return withTimeout(
    new Promise((resolve) => {
      ws.addEventListener(
        'message',
        (ev) => {
          resolve(JSON.parse(String(ev.data)));
        },
        { once: true }
      );
    }),
    1000,
    'wsNextMessage'
  );
}

test('executor: direct transport path used when reachable', async () => {
  const srv = await startHttpServer(async (req, res) => {
    if (req.method === 'GET') {
      res.statusCode = 200;
      res.end('ok');
      return;
    }

    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, received: JSON.parse(raw) }));
    });
  });

  try {
    const payload = { envelope: { hello: 'world' } };
    const out = await executeTransport({ peerUrl: srv.url, payload, relayAvailable: true, timeoutMs: 500 });
    assert.equal(out.ok, true);
    assert.equal(out.transport, 'direct');
    assert.equal(out.directReachable, true);
  } finally {
    await srv.close();
  }
});

test('executor: relay fallback used when direct unreachable', async () => {
  const relay = createRelayServer({ bindHost: '127.0.0.1', port: 0, wsPath: '/relay' });
  await relay.start();
  const { port } = relay.address();
  const relayUrl = `ws://127.0.0.1:${port}/relay`;

  const receiver = await wsOpen(relayUrl);

  try {
    // Register receiver as "target".
    const regAckP = wsNextMessage(receiver);
    receiver.send(JSON.stringify({ type: 'register', node: 'target' }));
    await regAckP;

    const payload = { envelope: { k: 'v' } };

    const forwardedP = wsNextMessage(receiver);

    const out = await executeTransport({
      peerUrl: 'http://127.0.0.1:9/',
      payload,
      relayAvailable: true,
      timeoutMs: 100,
      relayUrl,
      nodeId: 'sender',
      relayTo: 'target'
    });

    assert.equal(out.ok, true);
    assert.equal(out.transport, 'relay');

    const forwarded = await forwardedP;
    assert.deepEqual(forwarded, { from: 'sender', payload });
  } finally {
    try {
      receiver.close();
    } catch {
      // ignore
    }
    await relay.close();
  }
});

test('executor: fail closed when neither usable', async () => {
  await assert.rejects(
    () => executeTransport({ peerUrl: 'http://127.0.0.1:9/', payload: { x: 1 }, relayAvailable: false, timeoutMs: 50 }),
    (e) => e && e.code === 'NO_USABLE_TRANSPORT'
  );
});

test('executor: deterministic output result', async () => {
  const srv = await startHttpServer((req, res) => {
    res.statusCode = 200;
    res.end('ok');
  });
  try {
    const payload = { a: 1 };
    const a = await executeTransport({ peerUrl: srv.url, payload, relayAvailable: true, timeoutMs: 500 });
    const b = await executeTransport({ peerUrl: srv.url, payload, relayAvailable: true, timeoutMs: 500 });
    assert.deepEqual(Object.keys(a), Object.keys(b));
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.notEqual(a.transport, 'mailbox');
  } finally {
    await srv.close();
  }
});
