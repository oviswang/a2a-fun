import test from 'node:test';
import assert from 'node:assert/strict';

import { formalInboundEntry } from '../src/runtime/inbound/formalInboundEntry.mjs';

test('formal inbound entry: valid { envelope: {...} } candidate accepted', () => {
  const out = formalInboundEntry({
    envelope: {
      session_id: 's1',
      msg_id: 'm1',
      ts: '2026-01-01T00:00:00.000Z',
      type: 'probe.hello',
      sig: 'base64sig',
      ciphertext: 'base64cipher'
    }
  });
  assert.deepEqual(out, { ok: true, error: null });
});

test('formal inbound entry: missing envelope fails closed', () => {
  const out = formalInboundEntry({});
  assert.deepEqual(out, { ok: false, error: { code: 'MISSING_ENVELOPE' } });
});

test('formal inbound entry: non-object payload fails closed', () => {
  const out = formalInboundEntry('nope');
  assert.deepEqual(out, { ok: false, error: { code: 'INVALID_PAYLOAD' } });
});

test('formal inbound entry: deterministic machine-safe output shape', () => {
  const a = formalInboundEntry({ envelope: { session_id: 's', msg_id: 'm', ts: 't', type: 'x', sig: 's', ciphertext: 'c' } });
  const b = formalInboundEntry({ envelope: { session_id: 's', msg_id: 'm', ts: 't', type: 'x', sig: 's', ciphertext: 'c' } });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
