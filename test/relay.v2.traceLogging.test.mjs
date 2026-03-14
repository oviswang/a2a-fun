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
    ws.addEventListener('message', (ev) => resolve(JSON.parse(String(ev.data))), { once: true });
  });
}

async function getTraces(baseUrl) {
  const r = await fetch(`${baseUrl}/traces`);
  assert.equal(r.status, 200);
  return await r.json();
}

test('relay v2 /traces: empty initially; register/unregister appear', async () => {
  const srv = createRelayServerV2({ bindHost: '127.0.0.1', port: 0, wsPath: '/relay' });
  await srv.start();
  const addr = srv.address();
  const base = `http://127.0.0.1:${addr.port}`;
  const wsUrl = `ws://127.0.0.1:${addr.port}/relay`;

  const empty = await getTraces(base);
  assert.deepEqual(empty, { ok: true, traces: [] });

  const a = await wsOpen(wsUrl);
  try {
    a.send(JSON.stringify({ type: 'register', node_id: 'nodeA', session_id: 's1' }));
    await wsNextMessage(a);

    const t1 = await getTraces(base);
    assert.equal(t1.ok, true);
    assert.equal(t1.traces.length, 1);
    assert.equal(t1.traces[0].event, 'register');
    assert.equal(t1.traces[0].from, 'nodeA');

    a.close();
    await new Promise((r) => setTimeout(r, 200));

    const t2 = await getTraces(base);
    assert.equal(t2.traces.length, 2);
    assert.equal(t2.traces[1].event, 'unregister');
    assert.equal(t2.traces[1].from, 'nodeA');
  } finally {
    try { a.close(); } catch {}
    await srv.close();
  }
});

test('relay v2 /traces: relay_received/forwarded/dropped_no_target/dropped_invalid appear; bounded deterministically', async () => {
  const srv = createRelayServerV2({ bindHost: '127.0.0.1', port: 0, wsPath: '/relay' });
  await srv.start();
  const addr = srv.address();
  const base = `http://127.0.0.1:${addr.port}`;
  const wsUrl = `ws://127.0.0.1:${addr.port}/relay`;

  const a = await wsOpen(wsUrl);
  const b = await wsOpen(wsUrl);

  try {
    a.send(JSON.stringify({ type: 'register', node_id: 'nodeA', session_id: 'sa' }));
    b.send(JSON.stringify({ type: 'register', node_id: 'nodeB', session_id: 'sb' }));
    await wsNextMessage(a);
    await wsNextMessage(b);

    // forwarded
    a.send(JSON.stringify({ type: 'relay', trace_id: 't1', to: 'nodeB', payload: { kind: 'K1' } }));
    await wsNextMessage(b); // forwarded message
    await wsNextMessage(a); // ack

    // dropped_no_target
    a.send(JSON.stringify({ type: 'relay', trace_id: 't2', to: 'missing', payload: { kind: 'K2' } }));
    await wsNextMessage(a); // dropped

    // dropped_invalid (missing to)
    a.send(JSON.stringify({ type: 'relay', trace_id: 't3', payload: { kind: 'K3' } }));
    await wsNextMessage(a); // error

    const out = await getTraces(base);
    assert.equal(out.ok, true);

    const events = out.traces.map((t) => t.event);
    assert.ok(events.includes('relay_received'));
    assert.ok(events.includes('forwarded'));
    assert.ok(events.includes('dropped_no_target'));
    assert.ok(events.includes('dropped_invalid'));

    // Bounded log: push >1000 trace entries deterministically.
    for (let i = 0; i < 1100; i++) {
      a.send(JSON.stringify({ type: 'relay', trace_id: `bx${i}`, payload: { kind: 'B' } }));
      await wsNextMessage(a); // INVALID_TO error
    }

    const out2 = await getTraces(base);
    assert.equal(out2.traces.length, 1000);
    // Deterministic shape
    assert.deepEqual(Object.keys(out2.traces[0]).sort(), ['event', 'from', 'kind', 'to', 'trace_id', 'ts'].sort());
  } finally {
    try { a.close(); b.close(); } catch {}
    await srv.close();
  }
});
