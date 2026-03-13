import test from 'node:test';
import assert from 'node:assert/strict';

import { startRuntimeNode } from '../src/runtime/node/runtimeNode.mjs';
import { createHttpTransport } from '../src/runtime/transport/httpTransport.mjs';

function makeStorage() {
  const sessions = new Map();
  return {
    async readSession(session_id) {
      return sessions.get(session_id) ?? null;
    },
    async writeSession(session_id, state) {
      sessions.set(session_id, state);
    },
    _get(session_id) {
      return sessions.get(session_id);
    }
  };
}

test('runtime node: message received -> processor executed', async () => {
  const storage = makeStorage();
  const calls = [];

  const protocolProcessor = {
    async processInbound({ envelope, state }) {
      calls.push({ envelope, state });
      return {
        session_apply_result: {
          next_state: { ...state, state: 'PROBING' }
        },
        audit_records: []
      };
    }
  };

  const baseTransport = createHttpTransport();
  const transport = {
    ...baseTransport,
    async send() {
      throw new Error('not used');
    }
  };

  const node = await startRuntimeNode({
    port: 0,
    storage,
    identity: { local_actor_id: 'h:sha256:local' },
    deps: { protocolProcessor, transport }
  });

  const r = await fetch(`http://127.0.0.1:${node.port}/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ envelope: { session_id: 's1', peer_actor_id: 'h:sha256:peer' } })
  });
  const j = await r.json();

  assert.equal(r.status, 200);
  assert.equal(j.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(storage._get('s1').state, 'PROBING');

  await node.close();
});

test('runtime node: probe message produced -> outbound sent', async () => {
  const storage = makeStorage();
  const sends = [];

  const protocolProcessor = {
    async processInbound({ envelope, state }) {
      return {
        session_apply_result: {
          next_state: { ...state, state: 'PROBING' }
        },
        audit_records: []
      };
    }
  };

  const probeEngine = {
    next() {
      return { type: 'probe.question', body: { q: 'A safe question.' } };
    }
  };

  const baseTransport = createHttpTransport();
  const transport = {
    ...baseTransport,
    async send({ url, envelope }) {
      sends.push({ url, envelope });
      return { ok: true };
    }
  };

  const node = await startRuntimeNode({
    port: 0,
    storage,
    identity: { local_actor_id: 'h:sha256:local' },
    deps: { protocolProcessor, probeEngine, transport, runtimeOptions: { allowTestStubOutbound: true } }
  });

  const r = await fetch(`http://127.0.0.1:${node.port}/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      envelope: {
        session_id: 's1',
        peer_actor_id: 'h:sha256:peer',
        reply_to_url: 'http://127.0.0.1:9999/message'
      }
    })
  });
  const j = await r.json();

  assert.equal(r.status, 200);
  assert.equal(j.ok, true);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].url, 'http://127.0.0.1:9999/message');
  assert.equal(sends[0].envelope.stub, true);
  assert.equal(sends[0].envelope.type, 'probe.question');

  await node.close();
});

test('runtime node: invalid message -> fail closed', async () => {
  const storage = makeStorage();
  const protocolProcessor = { async processInbound() { throw new Error('not used'); } };

  const baseTransport = createHttpTransport();
  const transport = {
    ...baseTransport,
    async send() {
      throw new Error('not used');
    }
  };

  const node = await startRuntimeNode({
    port: 0,
    storage,
    identity: { local_actor_id: 'h:sha256:local' },
    deps: { protocolProcessor, transport }
  });

  const r = await fetch(`http://127.0.0.1:${node.port}/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json'
  });
  const j = await r.json();

  assert.equal(r.status, 400);
  assert.equal(j.ok, false);
  assert.equal(j.error, 'BAD_JSON');

  await node.close();
});

test('runtime node fail-closed: processor throw -> no session write / no outbound / no friendship', async () => {
  const storage = makeStorage();
  const sends = [];
  const friendshipCalls = [];

  const protocolProcessor = {
    async processInbound() {
      throw new Error('PROCESSOR_FAIL');
    }
  };

  const probeEngine = {
    next() {
      // Must not run if processor fails.
      throw new Error('probeEngine should not run');
    }
  };

  const friendshipTrigger = {
    async triggerFriendshipWriteIfNeeded() {
      friendshipCalls.push('called');
      return { status: 'SHOULD_NOT_RUN' };
    }
  };

  const baseTransport = createHttpTransport();
  const transport = {
    ...baseTransport,
    async send({ url, envelope }) {
      sends.push({ url, envelope });
      return { ok: true };
    }
  };

  const node = await startRuntimeNode({
    port: 0,
    storage,
    identity: { local_actor_id: 'h:sha256:local' },
    deps: {
      protocolProcessor,
      probeEngine,
      friendshipTrigger,
      transport,
      runtimeOptions: { allowTestStubOutbound: true, enableFriendshipTrigger: true }
    }
  });

  const r = await fetch(`http://127.0.0.1:${node.port}/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ envelope: { session_id: 's1', peer_actor_id: 'h:sha256:peer', reply_to_url: 'http://127.0.0.1:9999/message' } })
  });
  const j = await r.json();

  assert.equal(r.status, 400);
  assert.equal(j.ok, false);
  assert.equal(storage._get('s1'), undefined);
  assert.equal(sends.length, 0);
  assert.equal(friendshipCalls.length, 0);

  await node.close();
});

test('runtime node fail-closed: storage write fail -> subsequent steps do not run', async () => {
  const sessions = new Map();
  const storage = {
    async readSession(session_id) {
      return sessions.get(session_id) ?? null;
    },
    async writeSession() {
      throw new Error('WRITE_SESSION_FAIL');
    }
  };

  const sends = [];
  const probeCalls = [];
  const friendshipCalls = [];

  const protocolProcessor = {
    async processInbound({ envelope, state }) {
      return { session_apply_result: { next_state: { ...state, state: 'PROBING' } }, audit_records: [] };
    }
  };

  const probeEngine = {
    next() {
      probeCalls.push('called');
      return { type: 'probe.question', body: { q: 'A safe question.' } };
    }
  };

  const friendshipTrigger = {
    async triggerFriendshipWriteIfNeeded() {
      friendshipCalls.push('called');
      return { status: 'SHOULD_NOT_RUN' };
    }
  };

  const baseTransport = createHttpTransport();
  const transport = {
    ...baseTransport,
    async send({ url, envelope }) {
      sends.push({ url, envelope });
      return { ok: true };
    }
  };

  const node = await startRuntimeNode({
    port: 0,
    storage,
    identity: { local_actor_id: 'h:sha256:local' },
    deps: {
      protocolProcessor,
      probeEngine,
      friendshipTrigger,
      transport,
      runtimeOptions: { allowTestStubOutbound: true, enableFriendshipTrigger: true }
    }
  });

  const r = await fetch(`http://127.0.0.1:${node.port}/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ envelope: { session_id: 's1', peer_actor_id: 'h:sha256:peer', reply_to_url: 'http://127.0.0.1:9999/message' } })
  });
  const j = await r.json();

  assert.equal(r.status, 400);
  assert.equal(j.ok, false);
  assert.match(String(j.message), /WRITE_SESSION_FAIL/);

  // Must short-circuit after storage failure.
  assert.equal(probeCalls.length, 0);
  assert.equal(friendshipCalls.length, 0);
  assert.equal(sends.length, 0);

  await node.close();
});
