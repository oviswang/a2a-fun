import test from 'node:test';
import assert from 'node:assert/strict';

import { createRelayServer } from '../src/relay/relayServer.mjs';

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

test('relay server: register, relay, cleanup drop', async () => {
  const srv = createRelayServer({ bindHost: '127.0.0.1', port: 0, wsPath: '/relay' });
  await srv.start();

  const addr = srv.address();
  assert.ok(addr && typeof addr.port === 'number');

  const url = `ws://127.0.0.1:${addr.port}/relay`;

  const a = await wsOpen(url);
  const b = await wsOpen(url);

  try {
    a.send(JSON.stringify({ type: 'register', node: 'nodeA' }));
    b.send(JSON.stringify({ type: 'register', node: 'nodeB' }));

    const aReg = await wsNextMessage(a);
    const bReg = await wsNextMessage(b);
    assert.deepEqual(aReg, { ok: true, type: 'registered', node: 'nodeA' });
    assert.deepEqual(bReg, { ok: true, type: 'registered', node: 'nodeB' });

    a.send(JSON.stringify({ type: 'relay', to: 'nodeB', payload: { hello: 'world' } }));

    const forwarded = await wsNextMessage(b);
    assert.deepEqual(forwarded, { from: 'nodeA', payload: { hello: 'world' } });

    const ack = await wsNextMessage(a);
    assert.deepEqual(ack, { ok: true, type: 'relayed', to: 'nodeB' });

    // Disconnect B, then relay should drop.
    b.close();
    await new Promise((r) => setTimeout(r, 200));

    a.send(JSON.stringify({ type: 'relay', to: 'nodeB', payload: { again: true } }));
    const dropped = await wsNextMessage(a);
    assert.deepEqual(dropped, { ok: true, type: 'dropped', to: 'nodeB' });
  } finally {
    try {
      a.close();
      b.close();
    } catch {
      // ignore
    }
    await srv.close();
  }
});
