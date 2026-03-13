import test from 'node:test';
import assert from 'node:assert/strict';

import { startRuntimeNodeFormal } from '../src/runtime/node/runtimeNodeFormal.mjs';
import { createHttpTransport } from '../src/runtime/transport/httpTransport.mjs';

function makeStorage() {
  const sessions = new Map();
  return {
    async readSession(session_id) {
      return sessions.get(session_id) ?? null;
    },
    async writeSession(session_id, state) {
      sessions.set(session_id, state);
    }
  };
}

function makeProcessor(nextState = 'PROBING') {
  return {
    async processInbound({ envelope, state }) {
      return { session_apply_result: { next_state: { ...state, state: nextState } }, audit_records: [] };
    }
  };
}

test('runtime formal outbound: enableFormalOutbound=false -> no builder call, no send', async () => {
  const storage = makeStorage();
  const sends = [];
  const builderCalls = [];

  const baseTransport = createHttpTransport();
  const transport = {
    ...baseTransport,
    async send({ url, envelope }) {
      sends.push({ url, envelope });
      return { ok: true };
    }
  };

  const formalOutboundBuilder = {
    async buildFormalOutboundEnvelope() {
      builderCalls.push('called');
      return { status: 'FORMAL_ENVELOPE_READY', envelope: { sig: 'aGVsbG8=' } };
    }
  };

  const node = await startRuntimeNodeFormal({
    port: 0,
    storage,
    identity: { local_actor_id: 'h:sha256:local' },
    deps: {
      protocolProcessor: makeProcessor('PROBING'),
      probeEngine: { next: () => ({ type: 'probe.question', body: { q: 'A safe question.' } }) },
      transport,
      formalOutboundBuilder,
      runtimeOptions: { enableFormalOutbound: false }
    }
  });

  const r = await fetch(`http://127.0.0.1:${node.port}/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ envelope: { session_id: 's1', peer_actor_id: 'h:sha256:peer' } })
  });
  const j = await r.json();

  assert.equal(r.status, 200);
  assert.equal(j.ok, true);
  assert.equal(builderCalls.length, 0);
  assert.equal(sends.length, 0);

  await node.close();
});

test('runtime formal outbound: enableFormalOutbound=true -> builder called and transport.send called', async () => {
  const storage = makeStorage();
  const sends = [];
  const builderCalls = [];

  const baseTransport = createHttpTransport();
  const transport = {
    ...baseTransport,
    async send({ url, envelope }) {
      sends.push({ url, envelope });
      return { ok: true };
    }
  };

  const formalOutboundBuilder = {
    async buildFormalOutboundEnvelope(args) {
      builderCalls.push(args.type);
      return {
        status: 'FORMAL_ENVELOPE_READY',
        envelope: {
          v: '0.4.4',
          type: args.type,
          msg_id: 'm1',
          session_id: args.session_id,
          ts: args.ts,
          from: { actor_id: args.from_actor_id, key_fpr: args.from_key_fpr },
          to: { actor_id: args.to_actor_id, key_fpr: args.to_key_fpr },
          crypto: { enc: 'x', kdf: 'y', nonce: 'n' },
          body: { ciphertext: 'Y2lwaGVy', content_type: 'application/json' },
          sig: 'aGVsbG8='
        }
      };
    }
  };

  const node = await startRuntimeNodeFormal({
    port: 0,
    storage,
    identity: { local_actor_id: 'h:sha256:local' },
    deps: {
      protocolProcessor: makeProcessor('PROBING'),
      probeEngine: { next: () => ({ type: 'probe.question', body: { q: 'A safe question.' } }) },
      transport,
      formalOutboundBuilder,
      runtimeOptions: {
        enableFormalOutbound: true,
        formalOutboundUrl: 'http://127.0.0.1:9999/message',
        from_actor_id: 'h:sha256:from',
        from_key_fpr: 'sha256:fromkey',
        to_key_fpr: 'sha256:tokey',
        encrypt: async () => ({}),
        sign: async () => ''
      }
    }
  });

  const r = await fetch(`http://127.0.0.1:${node.port}/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ envelope: { session_id: 's1', peer_actor_id: 'h:sha256:peer' } })
  });

  assert.equal(r.status, 200);
  assert.equal(builderCalls.length, 1);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].url, 'http://127.0.0.1:9999/message');

  await node.close();
});

test('runtime formal outbound: builder failure -> no send', async () => {
  const storage = makeStorage();
  const sends = [];

  const baseTransport = createHttpTransport();
  const transport = {
    ...baseTransport,
    async send({ url, envelope }) {
      sends.push({ url, envelope });
      return { ok: true };
    }
  };

  const formalOutboundBuilder = {
    async buildFormalOutboundEnvelope() {
      throw new Error('BUILDER_FAIL');
    }
  };

  const node = await startRuntimeNodeFormal({
    port: 0,
    storage,
    identity: { local_actor_id: 'h:sha256:local' },
    deps: {
      protocolProcessor: makeProcessor('PROBING'),
      probeEngine: { next: () => ({ type: 'probe.question', body: { q: 'A safe question.' } }) },
      transport,
      formalOutboundBuilder,
      runtimeOptions: {
        enableFormalOutbound: true,
        formalOutboundUrl: 'http://127.0.0.1:9999/message',
        from_actor_id: 'h:sha256:from',
        from_key_fpr: 'sha256:fromkey',
        to_key_fpr: 'sha256:tokey',
        encrypt: async () => ({}),
        sign: async () => ''
      }
    }
  });

  const r = await fetch(`http://127.0.0.1:${node.port}/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ envelope: { session_id: 's1', peer_actor_id: 'h:sha256:peer' } })
  });
  const j = await r.json();

  assert.equal(r.status, 400);
  assert.equal(j.ok, false);
  assert.equal(sends.length, 0);

  await node.close();
});

test('runtime formal outbound: TEST_STUB_OUTBOUND path remains separate', async () => {
  const storage = makeStorage();
  const sends = [];
  const builderCalls = [];

  const baseTransport = createHttpTransport();
  const transport = {
    ...baseTransport,
    async send({ url, envelope }) {
      sends.push({ url, envelope });
      return { ok: true };
    }
  };

  const formalOutboundBuilder = {
    async buildFormalOutboundEnvelope() {
      builderCalls.push('called');
      return { status: 'FORMAL_ENVELOPE_READY', envelope: { sig: 'aGVsbG8=' } };
    }
  };

  const node = await startRuntimeNodeFormal({
    port: 0,
    storage,
    identity: { local_actor_id: 'h:sha256:local' },
    deps: {
      protocolProcessor: makeProcessor('PROBING'),
      probeEngine: { next: () => ({ type: 'probe.question', body: { q: 'A safe question.' } }) },
      transport,
      formalOutboundBuilder,
      runtimeOptions: { enableFormalOutbound: false, allowTestStubOutbound: true }
    }
  });

  const r = await fetch(`http://127.0.0.1:${node.port}/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ envelope: { session_id: 's1', peer_actor_id: 'h:sha256:peer', reply_to_url: 'http://127.0.0.1:9999/message' } })
  });

  assert.equal(r.status, 200);
  assert.equal(builderCalls.length, 0);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].envelope.stub, true);

  await node.close();
});

test('runtime formal outbound: when formal and test_stub both enabled, formal wins and stub must not send', async () => {
  const storage = makeStorage();
  const sends = [];
  const builderCalls = [];

  const baseTransport = createHttpTransport();
  const transport = {
    ...baseTransport,
    async send({ url, envelope }) {
      sends.push({ url, envelope });
      return { ok: true };
    }
  };

  const formalOutboundBuilder = {
    async buildFormalOutboundEnvelope(args) {
      builderCalls.push(args.type);
      return {
        status: 'FORMAL_ENVELOPE_READY',
        envelope: {
          v: '0.4.4',
          type: args.type,
          msg_id: 'm1',
          session_id: args.session_id,
          ts: args.ts,
          from: { actor_id: args.from_actor_id, key_fpr: args.from_key_fpr },
          to: { actor_id: args.to_actor_id, key_fpr: args.to_key_fpr },
          crypto: { enc: 'x', kdf: 'y', nonce: 'n' },
          body: { ciphertext: 'Y2lwaGVy', content_type: 'application/json' },
          sig: 'aGVsbG8='
        }
      };
    }
  };

  const node = await startRuntimeNodeFormal({
    port: 0,
    storage,
    identity: { local_actor_id: 'h:sha256:local' },
    deps: {
      protocolProcessor: makeProcessor('PROBING'),
      probeEngine: { next: () => ({ type: 'probe.question', body: { q: 'A safe question.' } }) },
      transport,
      formalOutboundBuilder,
      runtimeOptions: {
        enableFormalOutbound: true,
        formalOutboundUrl: 'http://127.0.0.1:9999/message',
        allowTestStubOutbound: true,
        from_actor_id: 'h:sha256:from',
        from_key_fpr: 'sha256:fromkey',
        to_key_fpr: 'sha256:tokey',
        encrypt: async () => ({}),
        sign: async () => ''
      }
    }
  });

  const r = await fetch(`http://127.0.0.1:${node.port}/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      envelope: {
        session_id: 's1',
        peer_actor_id: 'h:sha256:peer',
        // Even if reply_to_url is present, stub path must not run when formal is enabled.
        reply_to_url: 'http://127.0.0.1:9999/message'
      }
    })
  });

  assert.equal(r.status, 200);
  assert.equal(builderCalls.length, 1);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].url, 'http://127.0.0.1:9999/message');
  assert.equal(sends[0].envelope.stub, undefined);

  await node.close();
});
