import test from 'node:test';
import assert from 'node:assert/strict';

import { createCapabilityReference } from '../src/capability/capabilityReference.mjs';
import { createCapabilityInvocationRequest } from '../src/capability/capabilityInvocationRequest.mjs';
import { createCapabilityInvocationResult } from '../src/capability/capabilityInvocationResult.mjs';

import {
  createCapabilityHandlerRegistry,
  registerCapabilityHandler
} from '../src/execution/capabilityHandlerRegistry.mjs';

import { sendRemoteInvocation } from '../src/remote/remoteInvocationTransport.mjs';
import { handleRemoteInvocation } from '../src/remote/remoteExecutionEntry.mjs';
import {
  sendRemoteInvocationResult,
  handleRemoteInvocationResult
} from '../src/remote/remoteResultReturn.mjs';

test('Remote Execution Runtime local E2E (two-side in-memory harness): request -> remote exec -> result return', async () => {
  // Shared deterministic friendship context.
  const friendship_record = { friendship_id: 'fr_1', established: true };

  // Node B registry/handlers.
  const registry = createCapabilityHandlerRegistry();
  registerCapabilityHandler({
    registry,
    capability_id: 'cap_echo',
    handler: (payload) => ({ echoed: String(payload.msg || '') })
  });

  // Node A capability_reference -> invocation_request.
  const capability_reference = createCapabilityReference({
    friendship_record,
    capability: { capability_id: 'cap_echo', name: 'echo', summary: 'echo' }
  });
  const invocation_request = createCapabilityInvocationRequest({ capability_reference, payload: { msg: 'hi' } });
  assert.equal(typeof invocation_request.invocation_id, 'string');

  // In-memory transport simulation:
  // - Node A send delivers payload to Node B handler immediately.
  // - Node B send delivers payload back to Node A receiver.
  let deliveredResultPayload = null;

  const transportNodeBToA = async ({ payload }) => {
    deliveredResultPayload = payload;
    return { ok: true, transport: 'direct' };
  };

  const transportNodeAToB = async ({ payload }) => {
    // Node B entry
    const entryOut = handleRemoteInvocation({ payload, registry, friendship_record });

    // For this minimal E2E, if entry succeeded we return that invocation_result.
    // If entry failed, we still return a frozen invocation_result failure using the frozen primitive
    // (so the result-return primitive can be exercised end-to-end).
    const invReq = payload.invocation_request;

    const invocation_result = entryOut.ok
      ? entryOut.invocation_result
      : createCapabilityInvocationResult({
          invocation_request: invReq,
          ok: false,
          result: null,
          error: { code: entryOut.error.code }
        });

    await sendRemoteInvocationResult({
      transport: transportNodeBToA,
      peer: { peerUrl: 'in-memory://nodeA' },
      invocation_result
    });

    return { ok: true, transport: 'direct' };
  };

  // Node A sendRemoteInvocation packages REMOTE_INVOCATION_REQUEST.
  const sendOut = await sendRemoteInvocation({
    transport: transportNodeAToB,
    peer: { peerUrl: 'in-memory://nodeB' },
    invocation_request
  });
  assert.deepEqual(sendOut, { ok: true, transport_used: 'direct', sent: true, error: null });

  // Node A receives REMOTE_INVOCATION_RESULT.
  const recvOut = handleRemoteInvocationResult({ payload: deliveredResultPayload });
  assert.equal(recvOut.ok, true);
  assert.equal(recvOut.invocation_id, invocation_request.invocation_id);
  assert.equal(recvOut.invocation_result.ok, true);
  assert.deepEqual(recvOut.invocation_result.result, { echoed: 'hi' });

  // Failure path: unknown handler fails closed and returns machine-safe failure invocation_result.
  const caprefMissing = createCapabilityReference({
    friendship_record,
    capability: { capability_id: 'cap_missing', name: 'missing', summary: 'missing' }
  });
  const invReqMissing = createCapabilityInvocationRequest({ capability_reference: caprefMissing, payload: { msg: 'x' } });

  deliveredResultPayload = null;
  const sendOut2 = await sendRemoteInvocation({
    transport: transportNodeAToB,
    peer: { peerUrl: 'in-memory://nodeB' },
    invocation_request: invReqMissing
  });
  assert.equal(sendOut2.ok, true);

  const recvOut2 = handleRemoteInvocationResult({ payload: deliveredResultPayload });
  assert.equal(recvOut2.ok, true);
  assert.equal(recvOut2.invocation_result.ok, false);
  assert.deepEqual(recvOut2.invocation_result.error, { code: 'HANDLER_NOT_FOUND' });

  // Invalid remote payload fails closed (entry rejects wrong kind).
  const badEntryOut = handleRemoteInvocation({
    payload: { kind: 'WRONG_KIND', invocation_request },
    registry,
    friendship_record
  });
  assert.equal(badEntryOut.ok, false);
  assert.equal(badEntryOut.error.code, 'INVALID_KIND');

  // Friendship gating remains correct.
  const gateFail = handleRemoteInvocation({
    payload: { kind: 'REMOTE_INVOCATION_REQUEST', invocation_request },
    registry,
    friendship_record: { friendship_id: 'fr_other', established: true }
  });
  assert.equal(gateFail.ok, false);
  assert.equal(gateFail.error.code, 'INVALID_FRIENDSHIP');

  // No mailbox/orchestration/marketplace side-effects: extra fields are ignored (no throws / no shape leakage).
  const noisyPayload = {
    kind: 'REMOTE_INVOCATION_REQUEST',
    invocation_request: { ...invocation_request, mailbox: { x: 1 }, task_id: 't', marketplace_rank: 1 },
    mailbox: { y: 2 }
  };
  const noisyOut = handleRemoteInvocation({ payload: noisyPayload, registry, friendship_record });
  assert.deepEqual(Object.keys(noisyOut), ['ok', 'invocation_id', 'executed', 'invocation_result', 'error']);
});
