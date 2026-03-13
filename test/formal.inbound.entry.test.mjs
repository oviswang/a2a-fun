import test from 'node:test';
import assert from 'node:assert/strict';

import { formalInboundEntry } from '../src/runtime/inbound/formalInboundEntry.mjs';

test('formal inbound entry: valid { envelope: <valid Phase2Envelope> } passes strict validation', () => {
  const out = formalInboundEntry({
    envelope: {
      v: '0.4.3',
      type: 'human.entry',
      msg_id: 'm1',
      session_id: 's1',
      ts: '2026-03-13T00:00:00Z',
      from: { actor_id: 'h:sha256:a', key_fpr: 'k1' },
      to: { actor_id: 'h:sha256:b', key_fpr: 'k2' },
      crypto: { enc: 'aead', kdf: 'x', nonce: 'AA==' },
      body: { ciphertext: Buffer.from('{"x":1}', 'utf8').toString('base64'), content_type: 'application/json' },
      sig: 'sig'
    }
  });
  assert.deepEqual(out, { ok: true, validated: true, error: null });
});

test('formal inbound entry: missing envelope fails closed', () => {
  const out = formalInboundEntry({});
  assert.deepEqual(out, { ok: false, error: { code: 'MISSING_ENVELOPE' } });
});

test('formal inbound entry: non-object payload fails closed', () => {
  const out = formalInboundEntry('nope');
  assert.deepEqual(out, { ok: false, error: { code: 'INVALID_PAYLOAD' } });
});

test('formal inbound entry: invalid envelope shape fails closed', () => {
  const out = formalInboundEntry({ envelope: { v: '0.4.3' } });
  assert.deepEqual(out, { ok: false, error: { code: 'INVALID_ENVELOPE' } });
});

test('formal inbound entry: deterministic machine-safe output shape', () => {
  const env = {
    v: '0.4.3',
    type: 'human.entry',
    msg_id: 'm1',
    session_id: 's1',
    ts: '2026-03-13T00:00:00Z',
    from: { actor_id: 'h:sha256:a', key_fpr: 'k1' },
    to: { actor_id: 'h:sha256:b', key_fpr: 'k2' },
    crypto: { enc: 'aead', kdf: 'x', nonce: 'AA==' },
    body: { ciphertext: Buffer.from('{"x":1}', 'utf8').toString('base64'), content_type: 'application/json' },
    sig: 'sig'
  };

  const a = formalInboundEntry({ envelope: env });
  const b = formalInboundEntry({ envelope: env });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
