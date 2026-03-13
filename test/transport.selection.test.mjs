import test from 'node:test';
import assert from 'node:assert/strict';

import { selectTransport } from '../src/runtime/transport/selectTransport.mjs';

test('transport selection: direct available -> select direct', () => {
  assert.deepEqual(selectTransport({ directReachable: true, relayAvailable: true }), { transport: 'direct' });
  assert.deepEqual(selectTransport({ directReachable: true, relayAvailable: false }), { transport: 'direct' });
});

test('transport selection: direct unavailable + relay available -> select relay', () => {
  assert.deepEqual(selectTransport({ directReachable: false, relayAvailable: true }), { transport: 'relay' });
});

test('transport selection: both unavailable -> fail closed', () => {
  assert.throws(
    () => selectTransport({ directReachable: false, relayAvailable: false }),
    (e) => e && e.code === 'NO_USABLE_TRANSPORT'
  );
});

test('transport selection: deterministic output', () => {
  const a = selectTransport({ directReachable: false, relayAvailable: true });
  const b = selectTransport({ directReachable: false, relayAvailable: true });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('transport selection: no mailbox baseline selection', () => {
  const out = selectTransport({ directReachable: false, relayAvailable: true });
  assert.ok(!('mailbox' in out));
  assert.notEqual(out.transport, 'mailbox');
});
