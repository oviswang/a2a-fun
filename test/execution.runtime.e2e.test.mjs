import test from 'node:test';
import assert from 'node:assert/strict';

import { createCapabilityReference } from '../src/capability/capabilityReference.mjs';
import { createCapabilityInvocationRequest } from '../src/capability/capabilityInvocationRequest.mjs';

import {
  createCapabilityHandlerRegistry,
  registerCapabilityHandler,
  getCapabilityHandler
} from '../src/execution/capabilityHandlerRegistry.mjs';

import { executeInvocation } from '../src/execution/invocationExecutor.mjs';
import { adaptExecutionResult } from '../src/execution/resultAdapter.mjs';

test('Execution Runtime local E2E: capability_reference -> invocation_request -> registry -> executor -> adapter -> capability_invocation_result', () => {
  const friendship_record = { friendship_id: 'fr_1', established: true };
  const capability = { capability_id: 'cap_echo', name: 'echo', summary: 'returns payload' };

  // capability_reference input
  const capability_reference = createCapabilityReference({ friendship_record, capability });
  assert.equal(capability_reference.invocation_ready, true);

  // invocation_request
  const invocation_request = createCapabilityInvocationRequest({
    capability_reference,
    payload: { msg: 'hi' },
    task_id: 't1',
    mailbox: { x: 1 },
    marketplace_rank: 9
  });
  assert.equal(invocation_request.capability_id, 'cap_echo');
  assert.ok(typeof invocation_request.invocation_id === 'string' && invocation_request.invocation_id.length > 0);

  // registry + handler
  const registry = createCapabilityHandlerRegistry();
  registerCapabilityHandler({
    registry,
    capability_id: 'cap_echo',
    handler: (payload) => ({ echoed: String(payload.msg || '') })
  });
  assert.equal(typeof getCapabilityHandler({ registry, capability_id: 'cap_echo' }), 'function');

  // success execution
  const execOk = executeInvocation({ registry, invocation_request });
  const resOk = adaptExecutionResult({ invocation_request, execution_result: execOk });
  assert.equal(resOk.ok, true);
  assert.deepEqual(resOk.result, { echoed: 'hi' });
  assert.equal(resOk.error, null);

  // failure execution (thrown handler)
  registerCapabilityHandler({
    registry,
    capability_id: 'cap_fail',
    handler: () => { throw new Error('boom'); }
  });
  const capability_reference_fail = createCapabilityReference({
    friendship_record,
    capability: { capability_id: 'cap_fail', name: 'fail', summary: 'throws' }
  });
  const invocation_request_fail = createCapabilityInvocationRequest({ capability_reference: capability_reference_fail, payload: { a: 1 } });
  const execFail = executeInvocation({ registry, invocation_request: invocation_request_fail });
  const resFail = adaptExecutionResult({ invocation_request: invocation_request_fail, execution_result: execFail });
  assert.equal(resFail.ok, false);
  assert.equal(resFail.result, null);
  assert.deepEqual(resFail.error, { code: 'HANDLER_EXECUTION_FAILED' });

  // unknown capability_id fail-closed
  const capability_reference_missing = createCapabilityReference({
    friendship_record,
    capability: { capability_id: 'cap_missing', name: 'missing', summary: 'no handler' }
  });
  const invocation_request_missing = createCapabilityInvocationRequest({ capability_reference: capability_reference_missing, payload: { a: 1 } });
  const execMissing = executeInvocation({ registry, invocation_request: invocation_request_missing });
  assert.equal(execMissing.executed, false);
  assert.deepEqual(execMissing.error, { code: 'HANDLER_NOT_FOUND' });
  const resMissing = adaptExecutionResult({ invocation_request: invocation_request_missing, execution_result: execMissing });
  assert.equal(resMissing.ok, false);
  assert.deepEqual(resMissing.error, { code: 'HANDLER_NOT_FOUND' });

  // invalid invocation input fails closed
  assert.throws(
    () => createCapabilityInvocationRequest({ capability_reference, payload: null }),
    (e) => e && e.code === 'INVALID_PAYLOAD'
  );
});
