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
    if (msg && msg.type === 'ack') {
      if (expectedTraceId === null) {
        if (msg.trace_id === null) return msg;
      } else if (msg.trace_id === expectedTraceId) {
        return msg;
      }
    }
  }
  throw new Error('timeout waiting ack');
}

test('relay v2 ack: forwarded/dropped_no_target/dropped_invalid with trace_id handling', async () => {
  const srv = createRelayServerV2({ bindHost: '127.0.0.1', port: 0, wsPath: '/relay' });
  await srv.start();
  const addr = srv.address();
  const url = `ws://127.0.0.1:${addr.port}/relay`;

  const a = await wsOpen(url);
  const b = await wsOpen(url);

  const aC = createWsCollector(a);
  const bC = createWsCollector(b);

  try {
    a.send(JSON.stringify({ type: 'register', node_id: 'nodeA', session_id: 'sa' }));
    b.send(JSON.stringify({ type: 'register', node_id: 'nodeB', session_id: 'sb' }));

    // consume registration responses
    assert.deepEqual(await aC.next(), { ok: true, type: 'registered', node_id: 'nodeA', session_id: 'sa' });
    assert.deepEqual(await bC.next(), { ok: true, type: 'registered', node_id: 'nodeB', session_id: 'sb' });

    // forwarded (trace_id preserved)
    a.send(JSON.stringify({ type: 'relay', trace_id: 't1', to: 'nodeB', payload: { kind: 'K' } }));

    // target must receive forwarded payload
    assert.deepEqual(await bC.next(), { from: 'nodeA', payload: { kind: 'K' } });

    // sender must receive ack (after legacy relayed)
    const ack1 = await waitForAck(aC, 't1');
    assert.deepEqual(ack1, { type: 'ack', trace_id: 't1', status: 'forwarded', reason: null });

    // dropped_no_target
    a.send(JSON.stringify({ type: 'relay', trace_id: 't2', to: 'missing', payload: { kind: 'K2' } }));
    const ack2 = await waitForAck(aC, 't2');
    assert.deepEqual(ack2, { type: 'ack', trace_id: 't2', status: 'dropped_no_target', reason: 'NO_TARGET' });

    // dropped_invalid (missing to)
    a.send(JSON.stringify({ type: 'relay', trace_id: 't3', payload: { kind: 'K3' } }));
    const ack3 = await waitForAck(aC, 't3');
    assert.deepEqual(ack3, { type: 'ack', trace_id: 't3', status: 'dropped_invalid', reason: 'INVALID_TO' });

    // trace_id null when absent
    a.send(JSON.stringify({ type: 'relay', to: 'missing', payload: { kind: 'K4' } }));
    const ack4 = await waitForAck(aC, null);
    assert.deepEqual(ack4, { type: 'ack', trace_id: null, status: 'dropped_no_target', reason: 'NO_TARGET' });
  } finally {
    try { a.close(); b.close(); } catch {}
    await srv.close();
  }
});
