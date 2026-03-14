import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptExecutionResult } from '../src/execution/resultAdapter.mjs';

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

function makeExec(overrides = {}) {
  return {
    invocation_id: 'inv_1',
    executed: true,
    raw_result: { ok: true },
    error: null,
    ...overrides
  };
}

test('execution/resultAdapter: success execution adapts to capability invocation result success', () => {
  const out = adaptExecutionResult({
    invocation_request: makeReq(),
    execution_result: makeExec({ raw_result: { a: 1, b: true } })
  });

  assert.deepEqual(out, {
    invocation_id: 'inv_1',
    ok: true,
    result: { a: 1, b: true },
    error: null,
    created_at: new Date(0).toISOString()
  });
});

test('execution/resultAdapter: failure execution adapts to capability invocation result failure', () => {
  const out = adaptExecutionResult({
    invocation_request: makeReq(),
    execution_result: makeExec({ executed: false, raw_result: null, error: { code: 'HANDLER_NOT_FOUND' } })
  });

  assert.deepEqual(out, {
    invocation_id: 'inv_1',
    ok: false,
    result: null,
    error: { code: 'HANDLER_NOT_FOUND' },
    created_at: new Date(0).toISOString()
  });
});

test('execution/resultAdapter: invalid invocation_request fails closed', () => {
  assert.throws(
    () => adaptExecutionResult({ invocation_request: null, execution_result: makeExec() }),
    (e) => e && e.code === 'INVALID_INPUT'
  );
});

test('execution/resultAdapter: invalid execution_result fails closed', () => {
  assert.throws(
    () => adaptExecutionResult({ invocation_request: makeReq(), execution_result: { invocation_id: 'inv_1' } }),
    (e) => e && e.code === 'INVALID_EXECUTION_RESULT'
  );
});

test('execution/resultAdapter: invalid raw_result fails closed (INVALID_RESULT)', () => {
  assert.throws(
    () => adaptExecutionResult({
      invocation_request: makeReq(),
      execution_result: makeExec({ raw_result: { nested: { x: 1 } } })
    }),
    (e) => e && e.code === 'INVALID_RESULT'
  );
});

test('execution/resultAdapter: deterministic output shape + ignores extraneous fields', () => {
  const out = adaptExecutionResult({
    invocation_request: makeReq({ task_id: 't1', mailbox: { x: 1 }, marketplace_rank: 9 }),
    execution_result: makeExec({ raw_result: { a: 1 } , task_id: 't2', mailbox: { y: 2 } })
  });

  assert.deepEqual(Object.keys(out), ['invocation_id', 'ok', 'result', 'error', 'created_at']);
  assert.deepEqual(out.result, { a: 1 });
});
