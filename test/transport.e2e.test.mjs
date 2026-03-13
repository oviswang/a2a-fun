import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { executeTransport } from '../src/runtime/transport/executeTransport.mjs';
import { createRelayServer } from '../src/relay/relayServer.mjs';
import { handleDirectInbound } from '../src/runtime/inbound/directInbound.mjs';
import { handleRelayInbound } from '../src/runtime/inbound/relayInbound.mjs';

async function startNodeBDirectInbound({ onInbound }) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET') {
        res.statusCode = 200;
        res.end('ok');
        return;
      }
      if (req.method !== 'POST') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

      // executeTransport sends the payload as the raw JSON request body.
      // directInbound expects { payload }, so we adapt without mutating the payload.
      const raw = await new Promise((resolve, reject) => {
        let n = 0;
        const chunks = [];
        req.on('data', (c) => {
          n += c.length;
          if (n > 256 * 1024) {
            reject(new Error('too large'));
            return;
          }
          chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
      });

      const bodyObj = JSON.parse(raw);
      const { Readable } = await import('node:stream');
      const wrappedReq = Readable.from([Buffer.from(JSON.stringify({ payload: bodyObj }), 'utf8')]);

      await handleDirectInbound(wrappedReq, { onInbound });

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: false, code: e.code || 'FAIL_CLOSED' }));
    }
  });

  await new Promise((resolve) => server.listen(3001, '127.0.0.1', resolve));

  return {
    peerUrl: 'http://127.0.0.1:3001/',
    close: async () => new Promise((resolve) => server.close(() => resolve()))
  };
}

function wsOpen(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', (e) => reject(e), { once: true });
  });
}

function wsNextMessage(ws) {
  return new Promise((resolve) => {
    ws.addEventListener(
      'message',
      (ev) => {
        resolve(JSON.parse(String(ev.data)));
      },
      { once: true }
    );
  });
}

test('transport E2E (local): direct path + relay path + fail-closed validation', async () => {
  const payload = { envelope: { kind: 'TEST_PAYLOAD', n: 1 } };

  // -----------------
  // Direct path: Node A executeTransport -> HTTP POST -> Node B directInbound -> onInbound
  // -----------------
  let gotDirect = null;
  const nodeB = await startNodeBDirectInbound({
    onInbound: (p) => {
      gotDirect = p;
    }
  });

  try {
    const out = await executeTransport({
      peerUrl: nodeB.peerUrl,
      payload,
      relayAvailable: false,
      timeoutMs: 500
    });

    assert.equal(out.transport, 'direct');
    assert.deepEqual(gotDirect, payload);
  } finally {
    await nodeB.close();
  }

  // -----------------
  // Relay path: Node A executeTransport (direct unavailable) -> relayClient -> relayServer -> Node B relayInbound -> onInbound
  // -----------------
  let gotRelay = null;
  const relay = createRelayServer({ bindHost: '127.0.0.1', port: 0, wsPath: '/relay' });
  await relay.start();
  const relayUrl = `ws://127.0.0.1:${relay.address().port}/relay`;

  const nodeBRelayWs = await wsOpen(relayUrl);

  try {
    // Node B registers and forwards inbound via relayInbound.
    const regAckP = wsNextMessage(nodeBRelayWs);
    nodeBRelayWs.send(JSON.stringify({ type: 'register', node: 'nodeB' }));
    await regAckP;

    nodeBRelayWs.addEventListener('message', async (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg && typeof msg === 'object' && typeof msg.from === 'string' && 'payload' in msg) {
        await handleRelayInbound(msg, {
          onInbound: (p) => {
            gotRelay = p;
          }
        });
      }
    });

    // Direct intentionally unavailable (closed port 9), relay available.
    const out = await executeTransport({
      peerUrl: 'http://127.0.0.1:9/',
      payload,
      relayAvailable: true,
      timeoutMs: 100,
      relayUrl,
      nodeId: 'nodeA',
      relayTo: 'nodeB'
    });

    assert.equal(out.transport, 'relay');

    // Wait briefly for delivery.
    for (let i = 0; i < 50 && !gotRelay; i++) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(gotRelay, payload);
  } finally {
    try {
      nodeBRelayWs.close();
    } catch {
      // ignore
    }
    await relay.close();
  }

  // -----------------
  // Fail-closed cases
  // -----------------

  // 1) direct unavailable + relay unavailable -> fail closed
  await assert.rejects(
    () => executeTransport({ peerUrl: 'http://127.0.0.1:9/', payload, relayAvailable: false, timeoutMs: 50 }),
    (e) => e && e.code === 'NO_USABLE_TRANSPORT'
  );

  // 2) invalid inbound payload -> fail closed
  const badReq = new (await import('node:stream')).Readable({
    read() {
      this.push(Buffer.from(JSON.stringify({ nope: 1 }), 'utf8'));
      this.push(null);
    }
  });
  await assert.rejects(
    () => handleDirectInbound(badReq, { onInbound: () => {} }),
    (e) => e && e.code === 'MISSING_PAYLOAD'
  );
  await assert.rejects(
    () => handleRelayInbound({ payload: { a: 1 } }, { onInbound: () => {} }),
    (e) => e && e.code === 'INVALID_MESSAGE'
  );

  // 3) relay target not connected -> server drops safely (verified via raw WS)
  const relay2 = createRelayServer({ bindHost: '127.0.0.1', port: 0, wsPath: '/relay' });
  await relay2.start();
  const relay2Url = `ws://127.0.0.1:${relay2.address().port}/relay`;
  const sender = await wsOpen(relay2Url);
  try {
    const regAckP2 = wsNextMessage(sender);
    sender.send(JSON.stringify({ type: 'register', node: 'sender' }));
    await regAckP2;

    const dropAckP = wsNextMessage(sender);
    sender.send(JSON.stringify({ type: 'relay', to: 'missing-target', payload }));
    const dropAck = await dropAckP;
    assert.deepEqual(dropAck, { ok: true, type: 'dropped', to: 'missing-target' });
  } finally {
    try {
      sender.close();
    } catch {
      // ignore
    }
    await relay2.close();
  }
});
