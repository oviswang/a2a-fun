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

function makeFriendshipRecord(session_id = 's_invreq_1') {
  const cand = createFriendshipCandidate({ session_id, peer_actor_id: 'h:sha256:peer_invreq_1', phase3_state: 'PROBING' });
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

test('capability invocation request: valid capability_reference + payload produce invocation request', () => {
  const ref = makeCapabilityReference();

  const req = createCapabilityInvocationRequest({
    capability_reference: ref,
    payload: { message: 'hi', count: 1, ok: true }
  });

  assert.deepEqual(Object.keys(req), [
    'invocation_id',
    'capability_ref_id',
    'friendship_id',
    'capability_id',
    'payload',
    'created_at'
  ]);
  assert.ok(req.invocation_id.startsWith('inv:sha256:'));
  assert.equal(req.capability_ref_id, ref.capability_ref_id);
  assert.equal(req.friendship_id, ref.friendship_id);
  assert.equal(req.capability_id, ref.capability_id);
  assert.equal(req.created_at, new Date(0).toISOString());
});

test('capability invocation request: invalid capability_reference fails closed', () => {
  assert.throws(
    () => createCapabilityInvocationRequest({ capability_reference: null, payload: { a: 'b' } }),
    (e) => e && e.code === 'INVALID_INPUT'
  );
});

test('capability invocation request: non-invocation-ready reference fails closed', () => {
  const ref = makeCapabilityReference();
  const bad = { ...ref, invocation_ready: false };

  assert.throws(
    () => createCapabilityInvocationRequest({ capability_reference: bad, payload: { a: 'b' } }),
    (e) => e && e.code === 'INVALID_REFERENCE'
  );
});

test('capability invocation request: invalid payload fails closed', () => {
  const ref = makeCapabilityReference();

  assert.throws(
    () => createCapabilityInvocationRequest({ capability_reference: ref, payload: null }),
    (e) => e && e.code === 'INVALID_PAYLOAD'
  );

  assert.throws(
    () => createCapabilityInvocationRequest({ capability_reference: ref, payload: [] }),
    (e) => e && e.code === 'INVALID_PAYLOAD'
  );

  // nested object not allowed
  assert.throws(
    () => createCapabilityInvocationRequest({ capability_reference: ref, payload: { a: { b: 1 } } }),
    (e) => e && e.code === 'INVALID_PAYLOAD'
  );

  // too many keys
  const big = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'v']));
  assert.throws(
    () => createCapabilityInvocationRequest({ capability_reference: ref, payload: big }),
    (e) => e && e.code === 'INVALID_PAYLOAD'
  );
});

test('capability invocation request: deterministic output shape and values', () => {
  const ref = makeCapabilityReference();

  const payload = { b: '2', a: '1' }; // order should not matter for invocation_id
  const a = createCapabilityInvocationRequest({ capability_reference: ref, payload });
  const b = createCapabilityInvocationRequest({ capability_reference: ref, payload: { a: '1', b: '2' } });

  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('capability invocation request: no task/mailbox/marketplace fields leak into the request', () => {
  const ref = makeCapabilityReference();

  const req = createCapabilityInvocationRequest({ capability_reference: ref, payload: { a: 'b' } });
  for (const k of Object.keys(req)) {
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
    assert.ok(!k.includes('market'));
  }
});
