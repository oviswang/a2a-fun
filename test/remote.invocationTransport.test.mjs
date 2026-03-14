import test from 'node:test';
import assert from 'node:assert/strict';

import { sendRemoteInvocation } from '../src/remote/remoteInvocationTransport.mjs';

function makeInvocationRequest(overrides = {}) {
  return {
    invocation_id: 'inv_1',
    capability_ref_id: 'capref_1',
    friendship_id: 'fr_1',
    capability_id: 'cap_1',
    payload: { x: 1 },
    mailbox: { ignored: true },
    task_id: 't1',
    marketplace_rank: 999,
    ...overrides
  };
}

test('remoteInvocationTransport: packages invocation_request into REMOTE_INVOCATION_REQUEST payload', async () => {
  const calls = [];
  const transport = async (args) => {
    calls.push(args);
    return { ok: true, transport: 'direct' };
  };

  const peer = { peerUrl: 'http://example.com/message', relayAvailable: false };
  const invocation_request = makeInvocationRequest();

  const out = await sendRemoteInvocation({ transport, peer, invocation_request });

  assert.deepEqual(out, { ok: true, transport_used: 'direct', sent: true, error: null });
  assert.equal(calls.length, 1);

  assert.equal(calls[0].peerUrl, peer.peerUrl);
  assert.deepEqual(calls[0].payload, { kind: 'REMOTE_INVOCATION_REQUEST', invocation_request });
});

test('remoteInvocationTransport: transport helper is called with frozen transport args (no extra fields)', async () => {
  let got = null;
  const transport = async (args) => {
    got = args;
    return { ok: true, transport: 'relay' };
  };

  const peer = {
    peerUrl: 'http://peer.invalid/message',
    relayAvailable: true,
    relayUrl: 'ws://relay/relay',
    nodeId: 'nodeA',
    relayTo: 'nodeB',
    timeoutMs: 123,
    mailbox: { should_not_leak: true }
  };

  const out = await sendRemoteInvocation({ transport, peer, invocation_request: makeInvocationRequest() });
  assert.equal(out.ok, true);
  assert.equal(out.transport_used, 'relay');

  assert.deepEqual(Object.keys(got).sort(), ['nodeId', 'payload', 'peerUrl', 'relayAvailable', 'relayTo', 'relayUrl', 'timeoutMs'].sort());
});

test('remoteInvocationTransport: invalid invocation_request fails closed', async () => {
  const transport = async () => ({ ok: true, transport: 'direct' });
  const peer = { peerUrl: 'http://example.com/message' };

  const out = await sendRemoteInvocation({ transport, peer, invocation_request: { invocation_id: 'inv_1' } });
  assert.deepEqual(out, { ok: false, transport_used: null, sent: false, error: { code: 'INVALID_INPUT' } });
});

test('remoteInvocationTransport: transport error fails closed with machine-safe error', async () => {
  const transport = async () => {
    const e = new Error('boom');
    e.code = 'DIRECT_FAILED';
    throw e;
  };
  const peer = { peerUrl: 'http://example.com/message' };

  const out = await sendRemoteInvocation({ transport, peer, invocation_request: makeInvocationRequest() });
  assert.deepEqual(out, { ok: false, transport_used: null, sent: false, error: { code: 'DIRECT_FAILED' } });
});

test('remoteInvocationTransport: deterministic output shape + no mailbox/orchestration/marketplace leakage', async () => {
  const transport = async () => ({ ok: true, transport: 'direct' });
  const peer = { peerUrl: 'http://example.com/message', mailbox: { x: 1 }, task_id: 't1' };

  const out = await sendRemoteInvocation({ transport, peer, invocation_request: makeInvocationRequest() });
  assert.deepEqual(Object.keys(out), ['ok', 'transport_used', 'sent', 'error']);
});
