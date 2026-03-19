import test from 'node:test';
import assert from 'node:assert/strict';

import { createRelayServerV2 } from '../src/relay/relayServerV2.mjs';
import { createRelayClient } from '../src/runtime/transport/relayClient.mjs';
import { __resetRelaySingletonForTests } from '../src/runtime/network/relaySingleton.mjs';

async function getNodes(baseUrl) {
  const r = await fetch(`${baseUrl}/nodes`);
  assert.equal(r.status, 200);
  return await r.json();
}

test.skip('relay v2 client registration: sends v2 register shape; session_id exists and is stable', async () => {
  __resetRelaySingletonForTests();
  const srv = createRelayServerV2({ bindHost: '127.0.0.1', port: 0, wsPath: '/relay' });
  await srv.start();
  const addr = srv.address();
  const relayUrl = `ws://127.0.0.1:${addr.port}/relay`;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const forwarded = [];
  const client = createRelayClient({
    relayUrl,
    nodeId: 'nodeA',
    registrationMode: 'v2',
    onForward: (m) => forwarded.push(m)
  });

  try {
    await client.connect();

    const n1 = await getNodes(baseUrl);
    assert.equal(n1.ok, true);
    assert.equal(n1.nodes.length, 1);
    assert.equal(n1.nodes[0].node_id, 'nodeA');
    assert.ok(typeof n1.nodes[0].session_id === 'string' && n1.nodes[0].session_id.length > 0);
    const sid = n1.nodes[0].session_id;

    // Close and reconnect: session_id must remain stable for this client instance.
    await client.close();
    await client.connect();

    const n2 = await getNodes(baseUrl);
    assert.equal(n2.ok, true);
    assert.equal(n2.nodes.length, 1);
    assert.equal(n2.nodes[0].node_id, 'nodeA');
    assert.equal(n2.nodes[0].session_id, sid);

    assert.deepEqual(forwarded, []);
  } finally {
    try { await client.close(); } catch {}
    await srv.close();
  }
});

test('relay v2 client registration: invalid config fails closed', async () => {
  assert.throws(
    () => createRelayClient({ relayUrl: 'ws://127.0.0.1:1/relay', nodeId: 'x', registrationMode: 'nope', onForward: () => {} }),
    /invalid registrationMode/
  );
});
