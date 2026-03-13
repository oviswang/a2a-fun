import test from 'node:test';
import assert from 'node:assert/strict';

import { formalInboundEntry } from '../src/runtime/inbound/formalInboundEntry.mjs';

test('formal inbound entry: validated envelope with session_id -> session handoff succeeds', async () => {
  const storage = {
    async readSession(session_id) {
      if (session_id !== 's1') return null;
      return { session_id: 's1', state: 'DISCONNECTED', local_entered: false, remote_entered: false, peer_actor_id: 'h:sha256:a' };
    }
  };

  const out = await formalInboundEntry(
    {
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
    },
    { storage }
  );
  assert.deepEqual(out, {
    ok: true,
    validated: true,
    session_id: 's1',
    session_found: true,
    state: {
      session_id: 's1',
      state: 'DISCONNECTED',
      peer_actor_id: 'h:sha256:a',
      peer_key_fpr: null,
      local_entered: false,
      remote_entered: false,
      closed_reason: null
    },
    error: null
  });
});

test('formal inbound entry: missing envelope fails closed', async () => {
  const out = await formalInboundEntry({});
  assert.deepEqual(out, { ok: false, error: { code: 'MISSING_ENVELOPE' } });
});

test('formal inbound entry: non-object payload fails closed', async () => {
  const out = await formalInboundEntry('nope');
  assert.deepEqual(out, { ok: false, error: { code: 'INVALID_PAYLOAD' } });
});

test('formal inbound entry: session not found -> machine-safe result', async () => {
  const storage = { async readSession() { return null; } };

  const out = await formalInboundEntry({
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
  }, { storage });

  assert.deepEqual(out, {
    ok: true,
    validated: true,
    session_id: 's1',
    session_found: false,
    state: null,
    error: null
  });
});

test('formal inbound entry: validated envelope missing session_id -> fail closed', async () => {
  const out = await formalInboundEntry({
    envelope: {
      v: '0.4.3',
      type: 'human.entry',
      msg_id: 'm1',
      // session_id missing
      ts: '2026-03-13T00:00:00Z',
      from: { actor_id: 'h:sha256:a', key_fpr: 'k1' },
      to: { actor_id: 'h:sha256:b', key_fpr: 'k2' },
      crypto: { enc: 'aead', kdf: 'x', nonce: 'AA==' },
      body: { ciphertext: Buffer.from('{"x":1}', 'utf8').toString('base64'), content_type: 'application/json' },
      sig: 'sig'
    }
  });

  assert.deepEqual(out, { ok: false, error: { code: 'INVALID_ENVELOPE' } });
});

test('formal inbound entry: deterministic machine-safe output shape', async () => {
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

  const a = await formalInboundEntry({ envelope: env });
  const b = await formalInboundEntry({ envelope: env });
  assert.deepEqual(Object.keys(a), Object.keys(b));
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
