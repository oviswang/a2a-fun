import test from 'node:test';
import assert from 'node:assert/strict';

import { createRelayServerV2 } from '../src/relay/relayServerV2.mjs';
import { createRelayServer } from '../src/relay/relayServer.mjs';
import { createRelayClient } from '../src/runtime/transport/relayClient.mjs';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

test('relay v2 client receive: forwarded payload + ack handling (onForward + onAck)', async () => {
  const srv = createRelayServerV2({ bindHost: '127.0.0.1', port: 0, wsPath: '/relay' });
  await srv.start();
  const addr = srv.address();
  const relayUrl = `ws://127.0.0.1:${addr.port}/relay`;

  const aForwards = [];
  const bForwards = [];
  const aAcks = [];

  const a = createRelayClient({
    relayUrl,
    nodeId: 'nodeA',
    registrationMode: 'v2',
    onForward: (m) => aForwards.push(m),
    onAck: (m) => aAcks.push(m)
  });

  const b = createRelayClient({
    relayUrl,
    nodeId: 'nodeB',
    registrationMode: 'v2',
    onForward: (m) => bForwards.push(m)
  });

  try {
    await a.connect();
    await b.connect();

    await a.relay({ to: 'nodeB', payload: { kind: 'TEST', x: 1 } });

    // allow async message delivery
    await sleep(50);

    assert.deepEqual(bForwards, [{ from: 'nodeA', payload: { kind: 'TEST', x: 1 } }]);
    assert.deepEqual(aForwards, []);

    // Relay v2 ack exists; relayClient.relay does not provide trace_id, so trace_id is null.
    assert.equal(aAcks.length >= 1, true);
    assert.deepEqual(aAcks[aAcks.length - 1], { type: 'ack', trace_id: null, status: 'forwarded', reason: null });
  } finally {
    await a.close();
    await b.close();
    await srv.close();
  }
});

test('relay v1 mode remains unaffected (no ack required)', async () => {
  const srv = createRelayServer({ bindHost: '127.0.0.1', port: 0, wsPath: '/relay' });
  await srv.start();
  const addr = srv.address();
  const relayUrl = `ws://127.0.0.1:${addr.port}/relay`;

  const aAcks = [];
  const bForwards = [];

  const a = createRelayClient({
    relayUrl,
    nodeId: 'nodeA',
    registrationMode: 'v1',
    onForward: () => {},
    onAck: (m) => aAcks.push(m)
  });

  const b = createRelayClient({
    relayUrl,
    nodeId: 'nodeB',
    registrationMode: 'v1',
    onForward: (m) => bForwards.push(m)
  });

  try {
    await a.connect();
    await b.connect();

    await a.relay({ to: 'nodeB', payload: { kind: 'TEST' } });
    await sleep(50);

    assert.deepEqual(bForwards, [{ from: 'nodeA', payload: { kind: 'TEST' } }]);
    assert.deepEqual(aAcks, []);
  } finally {
    await a.close();
    await b.close();
    await srv.close();
  }
});
