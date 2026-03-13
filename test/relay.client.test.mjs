import test from 'node:test';
import assert from 'node:assert/strict';

import { createRelayServer } from '../src/relay/relayServer.mjs';
import { createRelayClient } from '../src/runtime/transport/relayClient.mjs';

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

test('relay client: connect, register, receive forwarded, disconnect handling', async () => {
  const srv = createRelayServer({ bindHost: '127.0.0.1', port: 0, wsPath: '/relay' });
  await srv.start();

  const addr = srv.address();
  assert.ok(addr && typeof addr.port === 'number');
  const relayUrl = `ws://127.0.0.1:${addr.port}/relay`;

  let got = null;
  let disconnected = false;

  const client = createRelayClient({
    relayUrl,
    nodeId: 'nodeB',
    onForward: (m) => {
      got = m;
    },
    onDisconnect: () => {
      disconnected = true;
    }
  });

  // Sender is a raw ws client.
  const sender = await wsOpen(relayUrl);

  try {
    await client.connect();

    // Sender registers as nodeA.
    sender.send(JSON.stringify({ type: 'register', node: 'nodeA' }));
    const senderAck = await wsNextMessage(sender);
    assert.equal(senderAck.ok, true);

    // Relay to nodeB; nodeB should receive forwarded.
    sender.send(JSON.stringify({ type: 'relay', to: 'nodeB', payload: { hello: 'world' } }));

    // Wait briefly for delivery.
    for (let i = 0; i < 20 && !got; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    assert.deepEqual(got, { from: 'nodeA', payload: { hello: 'world' } });

    // Disconnect handling: close the relay client.
    await client.close();
    for (let i = 0; i < 20 && !disconnected; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(disconnected, true);
  } finally {
    try {
      sender.close();
    } catch {
      // ignore
    }
    await srv.close();
  }
});
