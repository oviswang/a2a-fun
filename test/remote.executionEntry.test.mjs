import test from 'node:test';
import assert from 'node:assert/strict';

import { handleRemoteInvocation } from '../src/remote/remoteExecutionEntry.mjs';
import {
  createCapabilityHandlerRegistry,
  registerCapabilityHandler
} from '../src/execution/capabilityHandlerRegistry.mjs';

function makeInvocationRequest(overrides = {}) {
  return {
    invocation_id: 'inv_1',
    capability_ref_id: 'capref_1',
    friendship_id: 'fr_1',
    capability_id: 'cap_1',
    payload: { x: 1 },
    mailbox: { ignored: true },
    task_id: 't1',
    marketplace_rank: 9,
    ...overrides
  };
}

function makePayload(overrides = {}) {
  return {
    kind: 'REMOTE_INVOCATION_REQUEST',
    invocation_request: makeInvocationRequest(),
    ...overrides
  };
}

test('remoteExecutionEntry: valid REMOTE_INVOCATION_REQUEST executes successfully via local execution runtime', () => {
  const registry = createCapabilityHandlerRegistry();
  registerCapabilityHandler({
    registry,
    capability_id: 'cap_1',
    handler: (payload) => ({ ok: true, got: payload.x })
  });

  const out = handleRemoteInvocation({
    payload: makePayload(),
    registry,
    friendship_record: { friendship_id: 'fr_1', established: true }
  });

  assert.equal(out.ok, true);
  assert.equal(out.executed, true);
  assert.equal(out.invocation_id, 'inv_1');
  assert.equal(out.error, null);
  assert.deepEqual(out.invocation_result, {
    invocation_id: 'inv_1',
    ok: true,
    result: { got: 1, ok: true },
    error: null,
    created_at: new Date(0).toISOString()
  });
});

test('remoteExecutionEntry: invalid kind fails closed', () => {
  const out = handleRemoteInvocation({ payload: { kind: 'X' }, registry: {}, friendship_record: null });
  assert.deepEqual(out, { ok: false, invocation_id: null, executed: false, invocation_result: null, error: { code: 'INVALID_KIND' } });
});

test('remoteExecutionEntry: invalid payload fails closed', () => {
  const out = handleRemoteInvocation({ payload: null, registry: {}, friendship_record: null });
  assert.deepEqual(out, { ok: false, invocation_id: null, executed: false, invocation_result: null, error: { code: 'INVALID_PAYLOAD' } });
});

test('remoteExecutionEntry: missing friendship_record fails closed', () => {
  const out = handleRemoteInvocation({ payload: makePayload(), registry: {}, friendship_record: null });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'INVALID_FRIENDSHIP');
});

test('remoteExecutionEntry: non-established friendship fails closed', () => {
  const out = handleRemoteInvocation({
    payload: makePayload(),
    registry: {},
    friendship_record: { friendship_id: 'fr_1', established: false }
  });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'INVALID_FRIENDSHIP');
});

test('remoteExecutionEntry: mismatched friendship_id fails closed', () => {
  const out = handleRemoteInvocation({
    payload: makePayload({ invocation_request: makeInvocationRequest({ friendship_id: 'fr_x' }) }),
    registry: {},
    friendship_record: { friendship_id: 'fr_1', established: true }
  });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'INVALID_FRIENDSHIP');
});

test('remoteExecutionEntry: unknown handler fails closed with machine-safe error', () => {
  const registry = createCapabilityHandlerRegistry();
  const out = handleRemoteInvocation({
    payload: makePayload({ invocation_request: makeInvocationRequest({ capability_id: 'missing' }) }),
    registry,
    friendship_record: { friendship_id: 'fr_1', established: true }
  });

  assert.deepEqual(out, {
    ok: false,
    invocation_id: 'inv_1',
    executed: false,
    invocation_result: null,
    error: { code: 'HANDLER_NOT_FOUND' }
  });
});

test('remoteExecutionEntry: deterministic output shape + ignores extraneous fields', () => {
  const registry = createCapabilityHandlerRegistry();
  registerCapabilityHandler({ registry, capability_id: 'cap_1', handler: () => ({ ok: true }) });

  const out = handleRemoteInvocation({
    payload: makePayload({ mailbox: { x: 1 }, task_id: 't2', marketplace_rank: 10 }),
    registry,
    friendship_record: { friendship_id: 'fr_1', established: true, mailbox: { y: 2 } }
  });

  assert.deepEqual(Object.keys(out), ['ok', 'invocation_id', 'executed', 'invocation_result', 'error']);
});
