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
      (ev) => resolve(JSON.parse(String(ev.data))),
      { once: true }
    );
  });
}

async function getNodes(baseUrl) {
  const r = await fetch(`${baseUrl}/nodes`);
  assert.equal(r.status, 200);
  return await r.json();
}

test('relay v2 /nodes: empty list when no registrations exist', async () => {
  const srv = createRelayServerV2({ bindHost: '127.0.0.1', port: 0, wsPath: '/relay' });
  await srv.start();
  const addr = srv.address();
  const base = `http://127.0.0.1:${addr.port}`;

  try {
    const out = await getNodes(base);
    assert.deepEqual(out, { ok: true, nodes: [] });
  } finally {
    await srv.close();
  }
});

test('relay v2 /nodes: shows active sessions after registration; ordering + is_latest deterministic', async () => {
  const srv = createRelayServerV2({ bindHost: '127.0.0.1', port: 0, wsPath: '/relay' });
  await srv.start();
  const addr = srv.address();

  const wsUrl = `ws://127.0.0.1:${addr.port}/relay`;
  const base = `http://127.0.0.1:${addr.port}`;

  const a1 = await wsOpen(wsUrl);
  const a2 = await wsOpen(wsUrl);

  try {
    // Register same node_id with two sessions.
    a1.send(JSON.stringify({ type: 'register', node_id: 'nodeA', session_id: 's1' }));
    await wsNextMessage(a1);

    a2.send(JSON.stringify({ type: 'register', node_id: 'nodeA', session_id: 's2' }));
    await wsNextMessage(a2);

    const out = await getNodes(base);
    assert.equal(out.ok, true);
    assert.equal(out.nodes.length, 2);

    // Deterministic ordering by node_id then session_id.
    assert.deepEqual(
      out.nodes.map((n) => `${n.node_id}:${n.session_id}`),
      ['nodeA:s1', 'nodeA:s2']
    );

    // is_latest must be true for s2 (latest registration).
    const s1 = out.nodes.find((n) => n.session_id === 's1');
    const s2 = out.nodes.find((n) => n.session_id === 's2');
    assert.equal(typeof s1.connected_at, 'string');
    assert.equal(typeof s1.last_seen, 'string');
    assert.equal(s1.is_latest, false);
    assert.equal(s2.is_latest, true);

    // Close latest; /nodes should update deterministically.
    a2.close();
    await new Promise((r) => setTimeout(r, 200));

    const out2 = await getNodes(base);
    assert.equal(out2.ok, true);
    assert.deepEqual(out2.nodes.map((n) => `${n.node_id}:${n.session_id}:${n.is_latest}`), ['nodeA:s1:true']);
  } finally {
    try { a1.close(); a2.close(); } catch {}
    await srv.close();
  }
});
