import test from 'node:test';
import assert from 'node:assert/strict';

import { createFriendshipCandidate } from '../src/friendship/friendshipCandidate.mjs';
import { confirmFriendshipCandidateLocally } from '../src/friendship/friendshipConfirmation.mjs';
import { confirmFriendshipCandidateRemotely } from '../src/friendship/friendshipRemoteConfirmation.mjs';
import { triggerFriendshipPersistence } from '../src/friendship/friendshipPersistenceTrigger.mjs';

import { createCapabilityAdvertisement } from '../src/capability/capabilityAdvertisement.mjs';
import { discoverCapabilities } from '../src/capability/capabilityDiscovery.mjs';
import { createCapabilityReference } from '../src/capability/capabilityReference.mjs';

import { createCapabilityInvocationRequest } from '../src/capability/capabilityInvocationRequest.mjs';
import { createCapabilityInvocationResult } from '../src/capability/capabilityInvocationResult.mjs';

function makeFriendshipRecord(session_id = 's_inv_e2e_1') {
  const cand = createFriendshipCandidate({ session_id, peer_actor_id: 'h:sha256:peer_inv_e2e_1', phase3_state: 'PROBING' });
  const local = confirmFriendshipCandidateLocally({ candidate: cand });
  const mutual = confirmFriendshipCandidateRemotely({ candidate: local });
  return triggerFriendshipPersistence({ candidate: mutual });
}

function makeCapabilityReference() {
  const fr = makeFriendshipRecord();
  const ad = createCapabilityAdvertisement({
    friendship_record: fr,
    name: 'ping',
    summary: 'Responds with pong.',
    input_schema_ref: 'schema:ping:v1',
    output_schema_ref: 'schema:pong:v1'
  });
  const disc = discoverCapabilities({ friendship_record: fr, advertisements: [ad] });
  return createCapabilityReference({ friendship_record: fr, capability: disc.capabilities[0] });
}

function assertNoTaskMailboxMarketLeak(obj) {
  for (const k of Object.keys(obj)) {
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
    assert.ok(!k.includes('market'));
  }
}

test('Capability Invocation local E2E: capability_reference -> invocation_request -> success result -> failure result', () => {
  const ref = makeCapabilityReference();

  // 1) request
  const req = createCapabilityInvocationRequest({
    capability_reference: ref,
    payload: { message: 'hi' }
  });
  assert.ok(req.invocation_id);
  assert.equal(req.capability_ref_id, ref.capability_ref_id);
  assert.equal(req.friendship_id, ref.friendship_id);
  assert.equal(req.capability_id, ref.capability_id);
  assertNoTaskMailboxMarketLeak(req);

  // 2) success result
  const okRes = createCapabilityInvocationResult({
    invocation_request: req,
    ok: true,
    result: { pong: 'ok' },
    error: null
  });
  assert.equal(okRes.invocation_id, req.invocation_id);
  assert.equal(okRes.ok, true);
  assert.deepEqual(okRes.error, null);
  assertNoTaskMailboxMarketLeak(okRes);

  // 3) failure result
  const failRes = createCapabilityInvocationResult({
    invocation_request: req,
    ok: false,
    result: null,
    error: { code: 'EXECUTION_DISABLED' }
  });
  assert.equal(failRes.invocation_id, req.invocation_id);
  assert.equal(failRes.ok, false);
  assert.deepEqual(failRes.result, null);
  assert.deepEqual(failRes.error, { code: 'EXECUTION_DISABLED' });
  assertNoTaskMailboxMarketLeak(failRes);
});

test('Capability Invocation local E2E: invalid inputs fail closed', () => {
  const ref = makeCapabilityReference();

  assert.throws(
    () => createCapabilityInvocationRequest({ capability_reference: { ...ref, invocation_ready: false }, payload: { a: 'b' } }),
    (e) => e && e.code === 'INVALID_REFERENCE'
  );

  const req = createCapabilityInvocationRequest({ capability_reference: ref, payload: { a: 'b' } });

  assert.throws(
    () => createCapabilityInvocationResult({ invocation_request: null, ok: true, result: {}, error: null }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createCapabilityInvocationResult({ invocation_request: req, ok: false, result: null, error: null }),
    (e) => e && e.code === 'INVALID_ERROR'
  );
});
