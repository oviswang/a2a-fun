import test from 'node:test';
import assert from 'node:assert/strict';

import { createFriendshipCandidate } from '../src/friendship/friendshipCandidate.mjs';
import { confirmFriendshipCandidateLocally } from '../src/friendship/friendshipConfirmation.mjs';
import { confirmFriendshipCandidateRemotely } from '../src/friendship/friendshipRemoteConfirmation.mjs';
import { triggerFriendshipPersistence } from '../src/friendship/friendshipPersistenceTrigger.mjs';

import { createCapabilityAdvertisement } from '../src/capability/capabilityAdvertisement.mjs';

function makeFriendshipRecord() {
  const cand = createFriendshipCandidate({ session_id: 's_cap_1', peer_actor_id: 'h:sha256:peer_cap_1', phase3_state: 'PROBING' });
  const local = confirmFriendshipCandidateLocally({ candidate: cand });
  const mutual = confirmFriendshipCandidateRemotely({ candidate: local });
  return triggerFriendshipPersistence({ candidate: mutual });
}

test('capability advertisement: valid friendship_record + fields produce advertisement', () => {
  const fr = makeFriendshipRecord();

  const ad = createCapabilityAdvertisement({
    friendship_record: fr,
    name: 'ping',
    summary: 'Responds with pong.',
    input_schema_ref: 'schema:ping:v1',
    output_schema_ref: 'schema:pong:v1'
  });

  assert.deepEqual(Object.keys(ad), [
    'capability_id',
    'friendship_id',
    'name',
    'summary',
    'input_schema_ref',
    'output_schema_ref',
    'created_at'
  ]);

  assert.ok(ad.capability_id.startsWith('cap:sha256:'));
  assert.equal(ad.friendship_id, fr.friendship_id);
  assert.equal(ad.created_at, new Date(0).toISOString());
});

test('capability advertisement: invalid friendship_record fails closed', () => {
  assert.throws(
    () => createCapabilityAdvertisement({ friendship_record: null, name: 'n', summary: 's', input_schema_ref: 'i', output_schema_ref: 'o' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createCapabilityAdvertisement({ friendship_record: { friendship_id: '' }, name: 'n', summary: 's', input_schema_ref: 'i', output_schema_ref: 'o' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );
});

test('capability advertisement: non-established friendship fails closed', () => {
  assert.throws(
    () => createCapabilityAdvertisement({
      friendship_record: { friendship_id: 'friendship:sha256:x', established: false },
      name: 'n',
      summary: 's',
      input_schema_ref: 'i',
      output_schema_ref: 'o'
    }),
    (e) => e && e.code === 'INVALID_FRIENDSHIP'
  );
});

test('capability advertisement: bounded string validation enforced', () => {
  const fr = makeFriendshipRecord();

  assert.throws(
    () => createCapabilityAdvertisement({
      friendship_record: fr,
      name: 'x'.repeat(65),
      summary: 's',
      input_schema_ref: 'i',
      output_schema_ref: 'o'
    }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createCapabilityAdvertisement({
      friendship_record: fr,
      name: 'n',
      summary: 'x'.repeat(161),
      input_schema_ref: 'i',
      output_schema_ref: 'o'
    }),
    (e) => e && e.code === 'INVALID_INPUT'
  );
});

test('capability advertisement: deterministic output shape and values', () => {
  const fr = makeFriendshipRecord();

  const a = createCapabilityAdvertisement({
    friendship_record: fr,
    name: 'ping',
    summary: 'Responds with pong.',
    input_schema_ref: 'schema:ping:v1',
    output_schema_ref: 'schema:pong:v1'
  });

  const b = createCapabilityAdvertisement({
    friendship_record: fr,
    name: 'ping',
    summary: 'Responds with pong.',
    input_schema_ref: 'schema:ping:v1',
    output_schema_ref: 'schema:pong:v1'
  });

  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('capability advertisement: no task/mailbox/marketplace fields leak', () => {
  const fr = makeFriendshipRecord();

  const ad = createCapabilityAdvertisement({
    friendship_record: fr,
    name: 'ping',
    summary: 'Responds with pong.',
    input_schema_ref: 'schema:ping:v1',
    output_schema_ref: 'schema:pong:v1'
  });

  for (const k of Object.keys(ad)) {
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
    assert.ok(!k.includes('market'));
  }
});
