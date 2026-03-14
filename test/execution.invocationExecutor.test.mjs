import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCapabilityHandlerRegistry,
  registerCapabilityHandler
} from '../src/execution/capabilityHandlerRegistry.mjs';

import { executeInvocation } from '../src/execution/invocationExecutor.mjs';

function makeReq(overrides = {}) {
  return {
    invocation_id: 'inv_1',
    capability_ref_id: 'capref_1',
    friendship_id: 'fr_1',
    capability_id: 'cap_1',
    payload: { x: 1 },
    ...overrides
  };
}

test('execution/invocationExecutor: executes handler for valid invocation_request', () => {
  const registry = createCapabilityHandlerRegistry();
  registerCapabilityHandler({
    registry,
    capability_id: 'cap_1',
    handler: (payload) => ({ ok: true, got: payload.x })
  });

  const out = executeInvocation({ registry, invocation_request: makeReq() });

  assert.deepEqual(out, {
    invocation_id: 'inv_1',
    executed: true,
    raw_result: { ok: true, got: 1 },
    error: null
  });
});

test('execution/invocationExecutor: unknown capability_id fails closed deterministically', () => {
  const registry = createCapabilityHandlerRegistry();

  const out = executeInvocation({ registry, invocation_request: makeReq({ capability_id: 'missing' }) });

  assert.equal(out.invocation_id, 'inv_1');
  assert.equal(out.executed, false);
  assert.equal(out.raw_result, null);
  assert.deepEqual(out.error, { code: 'HANDLER_NOT_FOUND' });
});

test('execution/invocationExecutor: invalid invocation_request fails closed (throws)', () => {
  const registry = createCapabilityHandlerRegistry();

  assert.throws(
    () => executeInvocation({ registry, invocation_request: { invocation_id: 'inv_1' } }),
    (e) => e && e.code === 'INVALID_INVOCATION_REQUEST'
  );
});

test('execution/invocationExecutor: thrown handler error fails closed deterministically', () => {
  const registry = createCapabilityHandlerRegistry();
  registerCapabilityHandler({
    registry,
    capability_id: 'cap_1',
    handler: () => { throw new Error('boom'); }
  });

  const out = executeInvocation({ registry, invocation_request: makeReq() });

  assert.equal(out.invocation_id, 'inv_1');
  assert.equal(out.executed, false);
  assert.equal(out.raw_result, null);
  assert.deepEqual(out.error, { code: 'HANDLER_EXECUTION_FAILED' });
});

test('execution/invocationExecutor: deterministic output shape + ignores extraneous fields', () => {
  const registry = createCapabilityHandlerRegistry();
  registerCapabilityHandler({
    registry,
    capability_id: 'cap_1',
    handler: (payload) => ({ seen: Object.keys(payload).sort() })
  });

  const out = executeInvocation({
    registry,
    invocation_request: makeReq({
      payload: { a: 1, b: 2 },
      task_id: 't1',
      mailbox: { messages: ['x'] },
      marketplace_rank: 999
    })
  });

  assert.deepEqual(Object.keys(out), ['invocation_id', 'executed', 'raw_result', 'error']);
  assert.equal(out.invocation_id, 'inv_1');
  assert.equal(out.executed, true);
  assert.deepEqual(out.raw_result, { seen: ['a', 'b'] });
  assert.equal(out.error, null);
});
