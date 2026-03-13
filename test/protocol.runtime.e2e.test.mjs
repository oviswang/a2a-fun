import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { executeTransport } from '../src/runtime/transport/executeTransport.mjs';
import { handleDirectInbound } from '../src/runtime/inbound/directInbound.mjs';
import { formalInboundEntry } from '../src/runtime/inbound/formalInboundEntry.mjs';
import { createProtocolProcessor } from '../src/phase2/processor/protocolProcessor.mjs';

function makeValidEnvelope(session_id = 's1') {
  return {
    v: '0.4.3',
    type: 'human.entry',
    msg_id: 'm1',
    session_id,
    ts: '2026-03-13T00:00:00Z',
    from: { actor_id: 'h:sha256:a', key_fpr: 'k1' },
    to: { actor_id: 'h:sha256:b', key_fpr: 'k2' },
    crypto: { enc: 'aead', kdf: 'x', nonce: 'AA==' },
    body: { ciphertext: Buffer.from('{"x":1}', 'utf8').toString('base64'), content_type: 'application/json' },
    sig: 'sig'
  };
}

function makeProtocolProcessorWithSpy(spy) {
  return createProtocolProcessor({
    keyResolver: { async resolvePeerPublicKey() { return 'PEM'; } },
    verifier: { async verifyEnvelopeSignature() {} },
    decrypter: {
      async decryptCiphertext(envelope) {
        spy.called = true;
        spy.lastEnvelopeSessionId = envelope.session_id;
        return { entered: true, bind: { session_id: envelope.session_id, probe_transcript_hash: 'h' } };
      }
    },
    sessionManager: {
      async apply() {
        return { next_state: { state: 'DISCONNECTED' }, session_patch: {}, audit_events: [], outbound_messages: [] };
      },
      async applyLocalEvent() {
        throw new Error('not used');
      }
    },
    auditBinder: {
      bindAuditEventCore() {
        return { event_hash: 'x', preview_safe: { type: 'human.entry' } };
      }
    }
  });
}

async function startNodeBServer({ protocolProcessor, storage }) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET') {
        res.statusCode = 200;
        res.end('ok');
        return;
      }
      if (req.method !== 'POST') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

      // executeTransport sends payload as raw JSON body.
      // directInbound expects { payload }, so adapt without changing payload semantics.
      const raw = await new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
      });

      const bodyObj = JSON.parse(raw);
      const { Readable } = await import('node:stream');
      const wrappedReq = Readable.from([Buffer.from(JSON.stringify({ payload: bodyObj }), 'utf8')]);

      const out = await handleDirectInbound(wrappedReq, {
        onInbound: async (payload) => {
          return formalInboundEntry(payload, { storage, protocolProcessor });
        }
      });

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, out }));
    } catch (e) {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: { code: e.code || 'FAIL_CLOSED' } }));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    peerUrl: `http://127.0.0.1:${port}/`,
    close: async () => new Promise((resolve) => server.close(() => resolve()))
  };
}

test('local protocol-over-transport E2E: direct -> directInbound -> formalInboundEntry -> protocolProcessor -> machine-safe response', async () => {
  const spy = { called: false, lastEnvelopeSessionId: null };
  const protocolProcessor = makeProtocolProcessorWithSpy(spy);

  const storage = {
    async readSession() {
      return null;
    }
  };

  const nodeB = await startNodeBServer({ protocolProcessor, storage });
  try {
    const payload = { envelope: makeValidEnvelope('s1') };

    const out = await executeTransport({ peerUrl: nodeB.peerUrl, payload, relayAvailable: false, timeoutMs: 500 });
    assert.equal(out.transport, 'direct');

    // protocolProcessor invoked (spy via decrypter).
    assert.equal(spy.called, true);
    assert.equal(spy.lastEnvelopeSessionId, 's1');

    // Machine-safe response is returned from formalInboundEntry.
    assert.equal(out.ok, true);

    // Payload object should not be mutated locally.
    assert.deepEqual(payload, { envelope: makeValidEnvelope('s1') });
  } finally {
    await nodeB.close();
  }
});

test('local protocol-over-transport E2E: invalid input fail-closed (missing envelope)', async () => {
  const spy = { called: false, lastEnvelopeSessionId: null };
  const protocolProcessor = makeProtocolProcessorWithSpy(spy);
  const storage = { async readSession() { return null; } };

  const nodeB = await startNodeBServer({ protocolProcessor, storage });
  try {
    const payload = { nope: 1 };

    const out = await executeTransport({ peerUrl: nodeB.peerUrl, payload, relayAvailable: false, timeoutMs: 500 });
    assert.equal(out.transport, 'direct');

    // Processor must not be invoked.
    assert.equal(spy.called, false);
  } finally {
    await nodeB.close();
  }
});

// -----------------------------
// Phase 3 wiring (minimal): formalInboundEntry -> protocolProcessor -> Phase3 session/probe transition
// -----------------------------

test('phase3 wired path: SESSION_PROBE_INIT via processor hook advances NEW -> LOCAL_ENTERED (machine-safe)', async () => {
  const { formalInboundEntry } = await import('../src/runtime/inbound/formalInboundEntry.mjs');

  const protocolProcessor = {
    async processInbound() {
      return {
        session_apply_result: { next_state: { state: 'DISCONNECTED' } },
        audit_records: [],
        phase3_session_probe_message: { kind: 'SESSION_PROBE_INIT', session_id: 's1', peer_actor_id: 'h:sha256:peer' }
      };
    }
  };

  const out = await formalInboundEntry(
    {
      envelope: makeValidEnvelope('s1')
    },
    {
      storage: { async readSession() { return null; } },
      protocolProcessor
    }
  );

  assert.equal(out.ok, true);
  assert.equal(out.processed, true);
  assert.deepEqual(out.response.phase3, {
    session_id: 's1',
    state: 'LOCAL_ENTERED',
    local_entered: true,
    remote_entered: false
  });

  // Surface must remain machine-safe: no raw envelope, no decrypted body.
  assert.ok(!('envelope' in out));
  assert.ok(!('decrypted_body' in out));
});

test('phase3 wired path: SESSION_PROBE_ACK via processor hook advances LOCAL_ENTERED -> PROBING', async () => {
  const { formalInboundEntry } = await import('../src/runtime/inbound/formalInboundEntry.mjs');

  const protocolProcessor = {
    async processInbound() {
      return {
        session_apply_result: { next_state: { state: 'DISCONNECTED' } },
        audit_records: [],
        phase3_session_state: {
          session_id: 's1',
          peer_actor_id: 'h:sha256:peer',
          state: 'LOCAL_ENTERED',
          local_entered: true,
          remote_entered: false
        },
        phase3_session_probe_message: { kind: 'SESSION_PROBE_ACK', session_id: 's1', peer_actor_id: 'h:sha256:peer' }
      };
    }
  };

  const out = await formalInboundEntry(
    {
      envelope: makeValidEnvelope('s1')
    },
    {
      storage: { async readSession() { return null; } },
      protocolProcessor
    }
  );

  assert.equal(out.ok, true);
  assert.deepEqual(out.response.phase3, {
    session_id: 's1',
    state: 'PROBING',
    local_entered: true,
    remote_entered: true
  });
});

test('phase3 wired path: unsupported message kind fails closed with machine-safe error', async () => {
  const { formalInboundEntry } = await import('../src/runtime/inbound/formalInboundEntry.mjs');

  const protocolProcessor = {
    async processInbound() {
      return {
        session_apply_result: { next_state: { state: 'DISCONNECTED' } },
        audit_records: [],
        phase3_session_probe_message: { kind: 'NOPE', session_id: 's1', peer_actor_id: 'h:sha256:peer' }
      };
    }
  };

  const out = await formalInboundEntry(
    { envelope: makeValidEnvelope('s1') },
    { storage: { async readSession() { return null; } }, protocolProcessor }
  );

  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'UNKNOWN_KIND');
  assert.equal(out.processed, true);
  assert.equal(out.response, null);
});

test('phase3 wired path: deterministic output shape (keys stable)', async () => {
  const { formalInboundEntry } = await import('../src/runtime/inbound/formalInboundEntry.mjs');

  const protocolProcessor = {
    async processInbound() {
      return {
        session_apply_result: { next_state: { state: 'DISCONNECTED' } },
        audit_records: [],
        phase3_session_probe_message: { kind: 'SESSION_PROBE_INIT', session_id: 's1', peer_actor_id: 'h:sha256:peer' }
      };
    }
  };

  const a = await formalInboundEntry(
    { envelope: makeValidEnvelope('s1') },
    { storage: { async readSession() { return null; } }, protocolProcessor }
  );
  const b = await formalInboundEntry(
    { envelope: makeValidEnvelope('s1') },
    { storage: { async readSession() { return null; } }, protocolProcessor }
  );

  assert.deepEqual(Object.keys(a), Object.keys(b));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
