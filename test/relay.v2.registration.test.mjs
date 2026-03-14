import test from 'node:test';
import assert from 'node:assert/strict';

import { createRelayServerV2 } from '../src/relay/relayServerV2.mjs';

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

test('relay v2: valid registration succeeds', async () => {
  const srv = createRelayServerV2({ bindHost: '127.0.0.1', port: 0, wsPath: '/relay' });
  await srv.start();

  const addr = srv.address();
  const url = `ws://127.0.0.1:${addr.port}/relay`;

  const a = await wsOpen(url);
  try {
    a.send(JSON.stringify({ type: 'register', node_id: 'nodeA', session_id: 's1' }));
    const reg = await wsNextMessage(a);
    assert.deepEqual(reg, { ok: true, type: 'registered', node_id: 'nodeA', session_id: 's1' });
  } finally {
    try { a.close(); } catch {}
    await srv.close();
  }
});

test('relay v2: invalid registration fails closed', async () => {
  const srv = createRelayServerV2({ bindHost: '127.0.0.1', port: 0, wsPath: '/relay' });
  await srv.start();

  const addr = srv.address();
  const url = `ws://127.0.0.1:${addr.port}/relay`;

  const a = await wsOpen(url);
  try {
    a.send(JSON.stringify({ type: 'register', node_id: 'nodeA' }));
    const rej = await wsNextMessage(a);
    assert.deepEqual(rej, { ok: false, error: { code: 'INVALID_SESSION_ID', reason: 'required' } });
  } finally {
    try { a.close(); } catch {}
    await srv.close();
  }
});

test('relay v2: same node_id + same session_id replacement is deterministic (latest wins)', async () => {
  const srv = createRelayServerV2({ bindHost: '127.0.0.1', port: 0, wsPath: '/relay' });
  await srv.start();

  const addr = srv.address();
  const url = `ws://127.0.0.1:${addr.port}/relay`;

  const sender = await wsOpen(url);
  const b1 = await wsOpen(url);
  const b2 = await wsOpen(url);

  try {
    sender.send(JSON.stringify({ type: 'register', node_id: 'nodeA', session_id: 'sa' }));
    await wsNextMessage(sender);

    b1.send(JSON.stringify({ type: 'register', node_id: 'nodeB', session_id: 's1' }));
    const b1Reg = await wsNextMessage(b1);
    assert.equal(b1Reg.ok, true);

    // Replacement: same (nodeB,s1) registers again.
    b2.send(JSON.stringify({ type: 'register', node_id: 'nodeB', session_id: 's1' }));
    const b2Reg = await wsNextMessage(b2);
    assert.deepEqual(b2Reg, { ok: true, type: 'registered', node_id: 'nodeB', session_id: 's1' });

    sender.send(JSON.stringify({ type: 'relay', to: 'nodeB', payload: { x: 1 } }));

    const forwarded = await wsNextMessage(b2);
    assert.deepEqual(forwarded, { from: 'nodeA', payload: { x: 1 } });

    const ack = await wsNextMessage(sender);
    assert.deepEqual(ack, { ok: true, type: 'relayed', to: 'nodeB' });
  } finally {
    try { sender.close(); b1.close(); b2.close(); } catch {}
    await srv.close();
  }
});

test('relay v2: same node_id + different session_id behaves deterministically (latest session routes)', async () => {
  const srv = createRelayServerV2({ bindHost: '127.0.0.1', port: 0, wsPath: '/relay' });
  await srv.start();

  const addr = srv.address();
  const url = `ws://127.0.0.1:${addr.port}/relay`;

  const sender = await wsOpen(url);
  const b1 = await wsOpen(url);
  const b2 = await wsOpen(url);

  try {
    sender.send(JSON.stringify({ type: 'register', node_id: 'nodeA', session_id: 'sa' }));
    await wsNextMessage(sender);

    b1.send(JSON.stringify({ type: 'register', node_id: 'nodeB', session_id: 's1' }));
    await wsNextMessage(b1);

    b2.send(JSON.stringify({ type: 'register', node_id: 'nodeB', session_id: 's2' }));
    await wsNextMessage(b2);

    // Latest session s2 should receive.
    sender.send(JSON.stringify({ type: 'relay', to: 'nodeB', payload: { hello: true } }));
    const forwarded = await wsNextMessage(b2);
    assert.deepEqual(forwarded, { from: 'nodeA', payload: { hello: true } });

    await wsNextMessage(sender); // ack

    // Close latest (s2). Next relay should go to s1.
    b2.close();
    await new Promise((r) => setTimeout(r, 200));

    sender.send(JSON.stringify({ type: 'relay', to: 'nodeB', payload: { again: true } }));
    const forwarded2 = await wsNextMessage(b1);
    assert.deepEqual(forwarded2, { from: 'nodeA', payload: { again: true } });
  } finally {
    try { sender.close(); b1.close(); b2.close(); } catch {}
    await srv.close();
  }
});
