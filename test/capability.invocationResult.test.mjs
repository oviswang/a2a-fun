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

function makeFriendshipRecord(session_id = 's_invres_1') {
  const cand = createFriendshipCandidate({ session_id, peer_actor_id: 'h:sha256:peer_invres_1', phase3_state: 'PROBING' });
  const local = confirmFriendshipCandidateLocally({ candidate: cand });
  const mutual = confirmFriendshipCandidateRemotely({ candidate: local });
  return triggerFriendshipPersistence({ candidate: mutual });
}

function makeInvocationRequest() {
  const fr = makeFriendshipRecord();
  const ad = createCapabilityAdvertisement({
    friendship_record: fr,
    name: 'ping',
    summary: 'Responds with pong.',
    input_schema_ref: 'schema:ping:v1',
    output_schema_ref: 'schema:pong:v1'
  });
  const disc = discoverCapabilities({ friendship_record: fr, advertisements: [ad] });
  const ref = createCapabilityReference({ friendship_record: fr, capability: disc.capabilities[0] });
  return createCapabilityInvocationRequest({ capability_reference: ref, payload: { message: 'hi' } });
}

test('capability invocation result: valid success result can be created', () => {
  const req = makeInvocationRequest();

  const out = createCapabilityInvocationResult({
    invocation_request: req,
    ok: true,
    result: { pong: 'ok', n: 1 },
    error: null
  });

  assert.deepEqual(Object.keys(out), ['invocation_id', 'ok', 'result', 'error', 'created_at']);
  assert.equal(out.invocation_id, req.invocation_id);
  assert.equal(out.ok, true);
  assert.deepEqual(out.error, null);
  assert.equal(out.created_at, new Date(0).toISOString());
});

test('capability invocation result: valid failure result can be created', () => {
  const req = makeInvocationRequest();

  const out = createCapabilityInvocationResult({
    invocation_request: req,
    ok: false,
    result: null,
    error: { code: 'EXECUTION_DISABLED' }
  });

  assert.equal(out.invocation_id, req.invocation_id);
  assert.equal(out.ok, false);
  assert.deepEqual(out.result, null);
  assert.deepEqual(out.error, { code: 'EXECUTION_DISABLED' });
});

test('capability invocation result: invalid invocation_request fails closed', () => {
  assert.throws(
    () => createCapabilityInvocationResult({ invocation_request: null, ok: true, result: {}, error: null }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createCapabilityInvocationResult({ invocation_request: {}, ok: true, result: {}, error: null }),
    (e) => e && e.code === 'INVALID_INPUT'
  );
});

test('capability invocation result: invalid result payload fails closed', () => {
  const req = makeInvocationRequest();

  assert.throws(
    () => createCapabilityInvocationResult({ invocation_request: req, ok: true, result: null, error: null }),
    (e) => e && (e.code === 'INVALID_RESULT' || e.code === 'INVALID_INPUT')
  );

  assert.throws(
    () => createCapabilityInvocationResult({ invocation_request: req, ok: true, result: { a: { b: 1 } }, error: null }),
    (e) => e && e.code === 'INVALID_RESULT'
  );

  const big = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'v']));
  assert.throws(
    () => createCapabilityInvocationResult({ invocation_request: req, ok: true, result: big, error: null }),
    (e) => e && e.code === 'INVALID_RESULT'
  );
});

test('capability invocation result: invalid error payload fails closed', () => {
  const req = makeInvocationRequest();

  assert.throws(
    () => createCapabilityInvocationResult({ invocation_request: req, ok: false, result: null, error: null }),
    (e) => e && e.code === 'INVALID_ERROR'
  );

  assert.throws(
    () => createCapabilityInvocationResult({ invocation_request: req, ok: false, result: null, error: { code: '' } }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createCapabilityInvocationResult({ invocation_request: req, ok: false, result: null, error: { code: 'X', extra: 'nope' } }),
    (e) => e && e.code === 'INVALID_ERROR'
  );
});

test('capability invocation result: deterministic output shape and values', () => {
  const req = makeInvocationRequest();

  const a = createCapabilityInvocationResult({ invocation_request: req, ok: true, result: { b: '2', a: '1' }, error: null });
  const b = createCapabilityInvocationResult({ invocation_request: req, ok: true, result: { a: '1', b: '2' }, error: null });

  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('capability invocation result: no task/mailbox/marketplace fields leak into the result', () => {
  const req = makeInvocationRequest();

  const out = createCapabilityInvocationResult({ invocation_request: req, ok: false, result: null, error: { code: 'EXECUTION_DISABLED' } });
  for (const k of Object.keys(out)) {
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
    assert.ok(!k.includes('market'));
  }
});
