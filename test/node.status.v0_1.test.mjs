import test from 'node:test';
import assert from 'node:assert/strict';

import { getNodeStatus } from '../src/runtime/status/nodeStatus.mjs';
import { createHttpTransport } from '../src/runtime/transport/httpTransport.mjs';

test('node status v0.1: valid status utility returns deterministic machine-safe output', () => {
  const out = getNodeStatus({
    node_id: 'n1',
    relay_connected: true,
    capabilities: ['b', 'a'],
    peers: ['p2', 'p1'],
    friendships: ['f2', 'f1']
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.capabilities, ['a', 'b']);
  assert.deepEqual(out.peers, ['p1', 'p2']);
  assert.deepEqual(out.friendships, ['f1', 'f2']);
});

test('node status v0.1: invalid input fails closed', () => {
  assert.equal(getNodeStatus({ relay_connected: 'yes' }).ok, false);
  assert.equal(getNodeStatus({ capabilities: 'x' }).ok, false);
  assert.equal(getNodeStatus({ peers: [1] }).ok, false);
  assert.equal(getNodeStatus({ friendships: [{}] }).ok, false);
});

test('GET /status returns machine-safe JSON with official capability ids and safe defaults', async () => {
  const t = createHttpTransport();
  const srv = await t.startServer({
    port: 0,
    onMessage: async () => ({ ok: true })
  });

  try {
    const r = await fetch(`http://127.0.0.1:${srv.port}/status`);
    assert.equal(r.status, 200);
    const j = await r.json();

    assert.equal(j.ok, true);
    assert.equal(j.node_id, null);
    assert.equal(j.relay_connected, false);
    assert.deepEqual(j.peers, []);
    assert.deepEqual(j.friendships, []);

    // Must include official pack capability ids, deterministic ordering.
    assert.deepEqual(j.capabilities, ['echo', 'text_transform', 'translate']);
    assert.deepEqual([...j.capabilities].sort(), j.capabilities);
  } finally {
    await srv.close();
  }
});
