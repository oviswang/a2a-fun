import test from 'node:test';
import assert from 'node:assert/strict';

import { createRelayServerV2 } from '../src/relay/relayServerV2.mjs';
import { createWsCollector } from './helpers/wsCollector.mjs';

function wsOpen(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', (e) => reject(e), { once: true });
  });
}

async function waitForAck(collector, expectedTraceId, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const msg = await collector.next(timeoutMs - (Date.now() - start));
    if (msg && msg.type === 'ack' && msg.trace_id === expectedTraceId) return msg;
  }
  throw new Error('timeout waiting ack');
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
  const aC = createWsCollector(a);

  try {
    a.send(JSON.stringify({ type: 'register', node_id: 'nodeA', session_id: 's1' }));
    await aC.next(); // registered

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
  const aC = createWsCollector(a);
  const bC = createWsCollector(b);

  try {
    a.send(JSON.stringify({ type: 'register', node_id: 'nodeA', session_id: 'sa' }));
    b.send(JSON.stringify({ type: 'register', node_id: 'nodeB', session_id: 'sb' }));
    await aC.next();
    await bC.next();

    // forwarded
    a.send(JSON.stringify({ type: 'relay', trace_id: 't1', to: 'nodeB', payload: { kind: 'K1' } }));
    await bC.next(); // forwarded payload
    await waitForAck(aC, 't1');

    // dropped_no_target
    a.send(JSON.stringify({ type: 'relay', trace_id: 't2', to: 'missing', payload: { kind: 'K2' } }));
    await waitForAck(aC, 't2');

    // dropped_invalid (missing to)
    a.send(JSON.stringify({ type: 'relay', trace_id: 't3', payload: { kind: 'K3' } }));
    await waitForAck(aC, 't3');

    const out = await getTraces(base);
    assert.equal(out.ok, true);

    const events = out.traces.map((t) => t.event);
    assert.ok(events.includes('relay_received'));
    assert.ok(events.includes('forwarded'));
    assert.ok(events.includes('dropped_no_target'));
    assert.ok(events.includes('dropped_invalid'));

    // Bounded log: push >1000 trace entries deterministically.
    for (let i = 0; i < 1005; i++) {
      a.send(JSON.stringify({ type: 'relay', trace_id: `bx${i}`, payload: { kind: 'B' } }));
    }
    await new Promise((r) => setTimeout(r, 120));

    const out2 = await getTraces(base);
    assert.equal(out2.traces.length, 1000);
    assert.deepEqual(Object.keys(out2.traces[0]).sort(), ['event', 'from', 'kind', 'to', 'trace_id', 'ts'].sort());
  } finally {
    try { a.close(); b.close(); } catch {}
    await srv.close();
  }
});
