import test from 'node:test';
import assert from 'node:assert/strict';

import { createFriendshipCandidate } from '../src/friendship/friendshipCandidate.mjs';
import { confirmFriendshipCandidateLocally } from '../src/friendship/friendshipConfirmation.mjs';
import { confirmFriendshipCandidateRemotely } from '../src/friendship/friendshipRemoteConfirmation.mjs';
import { triggerFriendshipPersistence } from '../src/friendship/friendshipPersistenceTrigger.mjs';

import { createCapabilityAdvertisement } from '../src/capability/capabilityAdvertisement.mjs';
import { discoverCapabilities } from '../src/capability/capabilityDiscovery.mjs';

function makeFriendshipRecord(session_id = 's_cap_d_1') {
  const cand = createFriendshipCandidate({ session_id, peer_actor_id: 'h:sha256:peer_cap_d_1', phase3_state: 'PROBING' });
  const local = confirmFriendshipCandidateLocally({ candidate: cand });
  const mutual = confirmFriendshipCandidateRemotely({ candidate: local });
  return triggerFriendshipPersistence({ candidate: mutual });
}

test('capability discovery: valid friendship_record + advertisements produce discovery result', () => {
  const fr = makeFriendshipRecord();

  const ad1 = createCapabilityAdvertisement({
    friendship_record: fr,
    name: 'ping',
    summary: 'Responds with pong.',
    input_schema_ref: 'schema:ping:v1',
    output_schema_ref: 'schema:pong:v1'
  });

  const ad2 = createCapabilityAdvertisement({
    friendship_record: fr,
    name: 'echo',
    summary: 'Echoes short text.',
    input_schema_ref: 'schema:echo_in:v1',
    output_schema_ref: 'schema:echo_out:v1'
  });

  const out = discoverCapabilities({ friendship_record: fr, advertisements: [ad1, ad2] });

  assert.deepEqual(Object.keys(out), ['friendship_id', 'capabilities']);
  assert.equal(out.friendship_id, fr.friendship_id);
  assert.equal(out.capabilities.length, 2);
  assert.deepEqual(Object.keys(out.capabilities[0]), ['capability_id', 'name', 'summary']);
  assert.equal(out.capabilities[0].capability_id, ad1.capability_id);
  assert.equal(out.capabilities[1].capability_id, ad2.capability_id);
});

test('capability discovery: invalid friendship_record fails closed', () => {
  assert.throws(
    () => discoverCapabilities({ friendship_record: null, advertisements: [] }),
    (e) => e && e.code === 'INVALID_INPUT'
  );
});

test('capability discovery: non-established friendship fails closed', () => {
  assert.throws(
    () => discoverCapabilities({ friendship_record: { friendship_id: 'friendship:sha256:x', established: false }, advertisements: [] }),
    (e) => e && e.code === 'INVALID_FRIENDSHIP'
  );
});

test('capability discovery: mismatched friendship_id advertisements are excluded deterministically', () => {
  const fr1 = makeFriendshipRecord('s_cap_d_2');
  const fr2 = makeFriendshipRecord('s_cap_d_3');

  const ad1 = createCapabilityAdvertisement({
    friendship_record: fr1,
    name: 'ping',
    summary: 'Responds with pong.',
    input_schema_ref: 'schema:ping:v1',
    output_schema_ref: 'schema:pong:v1'
  });

  const adOther = createCapabilityAdvertisement({
    friendship_record: fr2,
    name: 'other',
    summary: 'Other friend capability.',
    input_schema_ref: 'schema:in',
    output_schema_ref: 'schema:out'
  });

  const out = discoverCapabilities({ friendship_record: fr1, advertisements: [ad1, adOther] });
  assert.equal(out.capabilities.length, 1);
  assert.equal(out.capabilities[0].capability_id, ad1.capability_id);
});

test('capability discovery: deterministic output shape and values', () => {
  const fr = makeFriendshipRecord('s_cap_d_4');
  const ad = createCapabilityAdvertisement({
    friendship_record: fr,
    name: 'ping',
    summary: 'Responds with pong.',
    input_schema_ref: 'schema:ping:v1',
    output_schema_ref: 'schema:pong:v1'
  });

  const a = discoverCapabilities({ friendship_record: fr, advertisements: [ad] });
  const b = discoverCapabilities({ friendship_record: fr, advertisements: [ad] });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('capability discovery: no task/mailbox/marketplace fields leak', () => {
  const fr = makeFriendshipRecord('s_cap_d_5');
  const ad = createCapabilityAdvertisement({
    friendship_record: fr,
    name: 'ping',
    summary: 'Responds with pong.',
    input_schema_ref: 'schema:ping:v1',
    output_schema_ref: 'schema:pong:v1'
  });

  const out = discoverCapabilities({ friendship_record: fr, advertisements: [ad] });

  for (const k of Object.keys(out)) {
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
    assert.ok(!k.includes('market'));
  }
});
