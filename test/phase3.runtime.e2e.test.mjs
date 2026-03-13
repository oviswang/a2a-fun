import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { executeTransport } from '../src/runtime/transport/executeTransport.mjs';
import { handleDirectInbound } from '../src/runtime/inbound/directInbound.mjs';
import { formalInboundEntry } from '../src/runtime/inbound/formalInboundEntry.mjs';

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

async function startNodeBServer({ protocolProcessor, storage }) {
  let last = null;

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET') {
        if (req.url === '/last') {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, last }));
          return;
        }

        res.statusCode = 200;
        res.end('ok');
        return;
      }
      if (req.method !== 'POST') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

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
        onInbound: async (payload) => formalInboundEntry(payload, { storage, protocolProcessor })
      });

      last = out;

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
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
    lastUrl: `http://127.0.0.1:${port}/last`,
    close: async () => new Promise((resolve) => server.close(() => resolve()))
  };
}

test('phase3 local E2E: executeTransport -> inbound bridge -> formalInboundEntry -> processor -> phase3 hook -> applySessionProbeMessage', async () => {
  const calls = [];

  // In-memory phase3 session state owned by Node B runtime layer for this test.
  let phase3State = null;

  const protocolProcessor = {
    async processInbound({ envelope }) {
      calls.push(envelope.type);

      // Drive the minimal Phase3 subset without broadening Phase2 semantics.
      // This simulates a processor implementation that emits the Phase3 hook payload.
      if (envelope.msg_id === 'm-init') {
        return {
          session_apply_result: { next_state: { state: 'DISCONNECTED' } },
          audit_records: [],
          phase3_session_probe_message: {
            kind: 'SESSION_PROBE_INIT',
            session_id: envelope.session_id,
            peer_actor_id: 'h:sha256:peer'
          }
        };
      }

      if (envelope.msg_id === 'm-ack') {
        return {
          session_apply_result: { next_state: { state: 'DISCONNECTED' } },
          audit_records: [],
          phase3_session_state: phase3State,
          phase3_session_probe_message: {
            kind: 'SESSION_PROBE_ACK',
            session_id: envelope.session_id,
            peer_actor_id: 'h:sha256:peer'
          }
        };
      }

      if (envelope.msg_id === 'm-bad') {
        return {
          session_apply_result: { next_state: { state: 'DISCONNECTED' } },
          audit_records: [],
          phase3_session_probe_message: {
            kind: 'NOPE',
            session_id: envelope.session_id,
            peer_actor_id: 'h:sha256:peer'
          }
        };
      }

      throw new Error('unexpected test msg');
    }
  };

  const storage = { async readSession() { return null; } };

  const nodeB = await startNodeBServer({ protocolProcessor, storage });
  try {
    // -----------------
    // INIT
    // -----------------
    const initEnvelope = { ...makeValidEnvelope('s1'), msg_id: 'm-init' };
    const initPayload = { envelope: initEnvelope };

    const initOut = await executeTransport({ peerUrl: nodeB.peerUrl, payload: initPayload, relayAvailable: false, timeoutMs: 500 });
    assert.equal(initOut.ok, true);
    assert.equal(initOut.transport, 'direct');

    const initLast = await (await fetch(nodeB.lastUrl)).json();
    const initBridge = initLast.last;
    assert.ok(initBridge && initBridge.ok === true);

    assert.deepEqual(initBridge.response.phase3, {
      session_id: 's1',
      state: 'LOCAL_ENTERED',
      local_entered: true,
      remote_entered: false
    });

    // Persist state locally for ACK step (minimal same-machine E2E).
    phase3State = initBridge.response.phase3;

    // -----------------
    // ACK
    // -----------------
    const ackEnvelope = { ...makeValidEnvelope('s1'), msg_id: 'm-ack' };
    const ackPayload = { envelope: ackEnvelope };

    const ackOut = await executeTransport({ peerUrl: nodeB.peerUrl, payload: ackPayload, relayAvailable: false, timeoutMs: 500 });
    assert.equal(ackOut.ok, true);

    const ackLast = await (await fetch(nodeB.lastUrl)).json();
    const ackBridge = ackLast.last;
    assert.ok(ackBridge && ackBridge.ok === true);

    assert.deepEqual(ackBridge.response.phase3, {
      session_id: 's1',
      state: 'PROBING',
      local_entered: true,
      remote_entered: true
    });

    // -----------------
    // FAIL-CLOSED: unsupported kind
    // -----------------
    const badEnvelope = { ...makeValidEnvelope('s1'), msg_id: 'm-bad' };
    const badPayload = { envelope: badEnvelope };

    const badOut = await executeTransport({ peerUrl: nodeB.peerUrl, payload: badPayload, relayAvailable: false, timeoutMs: 500 });
    assert.equal(badOut.ok, true);

    const badLast = await (await fetch(nodeB.lastUrl)).json();
    const badBridge = badLast.last;

    // formalInboundEntry must fail closed with machine-safe error.
    assert.ok(badBridge && badBridge.ok === false);
    assert.equal(badBridge.error.code, 'UNKNOWN_KIND');

    // -----------------
    // Proof points
    // -----------------
    assert.equal(calls.length, 3);

    // No friendship side-effects should occur in this Phase3 E2E.
    assert.ok(!('friendship' in initBridge));
    assert.ok(!('friendship' in ackBridge));
  } finally {
    await nodeB.close();
  }
});
