import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sendRemoteInvocationResult,
  handleRemoteInvocationResult
} from '../src/remote/remoteResultReturn.mjs';

function makeInvocationResult(overrides = {}) {
  return {
    invocation_id: 'inv_1',
    ok: true,
    result: { a: 1 },
    error: null,
    created_at: new Date(0).toISOString(),
    mailbox: { ignored: true },
    task_id: 't1',
    marketplace_rank: 9,
    ...overrides
  };
}

test('remoteResultReturn: packages invocation_result into REMOTE_INVOCATION_RESULT payload', async () => {
  const calls = [];
  const transport = async (args) => {
    calls.push(args);
    return { ok: true, transport: 'direct' };
  };

  const peer = { peerUrl: 'http://example.com/message', relayAvailable: false };
  const invocation_result = makeInvocationResult();

  const out = await sendRemoteInvocationResult({ transport, peer, invocation_result });

  assert.deepEqual(out, { ok: true, transport_used: 'direct', sent: true, error: null });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].payload, { kind: 'REMOTE_INVOCATION_RESULT', invocation_result });
});

test('remoteResultReturn: send helper calls transport with frozen args only (no extra fields)', async () => {
  let got = null;
  const transport = async (args) => {
    got = args;
    return { ok: true, transport: 'relay' };
  };

  const peer = {
    peerUrl: 'http://peer.invalid/message',
    relayAvailable: true,
    relayUrl: 'ws://relay/relay',
    nodeId: 'nodeB',
    relayTo: 'nodeA',
    timeoutMs: 99,
    mailbox: { should_not_leak: true }
  };

  const out = await sendRemoteInvocationResult({ transport, peer, invocation_result: makeInvocationResult() });
  assert.equal(out.ok, true);
  assert.equal(out.transport_used, 'relay');

  assert.deepEqual(Object.keys(got).sort(), ['nodeId', 'payload', 'peerUrl', 'relayAvailable', 'relayTo', 'relayUrl', 'timeoutMs'].sort());
});

test('remoteResultReturn: send result deterministic on success', async () => {
  const transport = async () => ({ ok: true, transport: 'direct' });
  const out = await sendRemoteInvocationResult({
    transport,
    peer: { peerUrl: 'http://example.com/message' },
    invocation_result: makeInvocationResult({ result: { b: true } })
  });
  assert.deepEqual(out, { ok: true, transport_used: 'direct', sent: true, error: null });
});

test('remoteResultReturn: invalid invocation_result fails closed on send', async () => {
  const transport = async () => ({ ok: true, transport: 'direct' });
  const out = await sendRemoteInvocationResult({
    transport,
    peer: { peerUrl: 'http://example.com/message' },
    invocation_result: { invocation_id: 'inv_1' }
  });
  assert.deepEqual(out, { ok: false, transport_used: null, sent: false, error: { code: 'INVALID_INVOCATION_RESULT' } });
});

test('remoteResultReturn: transport error fails closed on send', async () => {
  const transport = async () => {
    const e = new Error('boom');
    e.code = 'DIRECT_FAILED';
    throw e;
  };

  const out = await sendRemoteInvocationResult({
    transport,
    peer: { peerUrl: 'http://example.com/message' },
    invocation_result: makeInvocationResult()
  });

  assert.deepEqual(out, { ok: false, transport_used: null, sent: false, error: { code: 'DIRECT_FAILED' } });
});

test('remoteResultReturn: valid REMOTE_INVOCATION_RESULT is handled correctly on receive', () => {
  const invocation_result = makeInvocationResult({ result: { a: 1 } });
  const out = handleRemoteInvocationResult({ payload: { kind: 'REMOTE_INVOCATION_RESULT', invocation_result } });
  assert.deepEqual(out, { ok: true, invocation_id: 'inv_1', invocation_result, error: null });
});

test('remoteResultReturn: invalid kind fails closed on receive', () => {
  const out = handleRemoteInvocationResult({ payload: { kind: 'X' } });
  assert.deepEqual(out, { ok: false, invocation_id: null, invocation_result: null, error: { code: 'INVALID_KIND' } });
});

test('remoteResultReturn: invalid payload fails closed on receive', () => {
  const out = handleRemoteInvocationResult({ payload: null });
  assert.deepEqual(out, { ok: false, invocation_id: null, invocation_result: null, error: { code: 'INVALID_PAYLOAD' } });
});

test('remoteResultReturn: no mailbox/orchestration/marketplace fields leak into behavior', async () => {
  const transport = async () => ({ ok: true, transport: 'direct' });
  const out = await sendRemoteInvocationResult({
    transport,
    peer: { peerUrl: 'http://example.com/message', mailbox: { x: 1 }, task_id: 't1' },
    invocation_result: makeInvocationResult({ mailbox: { y: 2 }, task_id: 't2' })
  });
  assert.deepEqual(Object.keys(out), ['ok', 'transport_used', 'sent', 'error']);
});
