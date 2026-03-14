import test from 'node:test';
import assert from 'node:assert/strict';

import { createFriendshipCandidate } from '../src/friendship/friendshipCandidate.mjs';
import { confirmFriendshipCandidateLocally } from '../src/friendship/friendshipConfirmation.mjs';
import { confirmFriendshipCandidateRemotely } from '../src/friendship/friendshipRemoteConfirmation.mjs';
import { triggerFriendshipPersistence } from '../src/friendship/friendshipPersistenceTrigger.mjs';

import { createCapabilityAdvertisement } from '../src/capability/capabilityAdvertisement.mjs';
import { discoverCapabilities } from '../src/capability/capabilityDiscovery.mjs';
import { createCapabilityReference } from '../src/capability/capabilityReference.mjs';

function makeFriendshipRecord(session_id = 's_cap_r_1') {
  const cand = createFriendshipCandidate({ session_id, peer_actor_id: 'h:sha256:peer_cap_r_1', phase3_state: 'PROBING' });
  const local = confirmFriendshipCandidateLocally({ candidate: cand });
  const mutual = confirmFriendshipCandidateRemotely({ candidate: local });
  return triggerFriendshipPersistence({ candidate: mutual });
}

test('capability reference: valid friendship_record + capability produce capability reference', () => {
  const fr = makeFriendshipRecord();
  const ad = createCapabilityAdvertisement({
    friendship_record: fr,
    name: 'ping',
    summary: 'Responds with pong.',
    input_schema_ref: 'schema:ping:v1',
    output_schema_ref: 'schema:pong:v1'
  });

  const disc = discoverCapabilities({ friendship_record: fr, advertisements: [ad] });
  const cap = disc.capabilities[0];

  const ref = createCapabilityReference({ friendship_record: fr, capability: cap });

  assert.deepEqual(Object.keys(ref), [
    'capability_ref_id',
    'friendship_id',
    'capability_id',
    'name',
    'invocation_ready',
    'created_at'
  ]);
  assert.ok(ref.capability_ref_id.startsWith('capref:sha256:'));
  assert.equal(ref.friendship_id, fr.friendship_id);
  assert.equal(ref.capability_id, cap.capability_id);
  assert.equal(ref.name, cap.name);
  assert.equal(ref.invocation_ready, true);
  assert.equal(ref.created_at, new Date(0).toISOString());
});

test('capability reference: invalid friendship_record fails closed', () => {
  assert.throws(
    () => createCapabilityReference({ friendship_record: null, capability: { capability_id: 'c', name: 'n', summary: 's' } }),
    (e) => e && e.code === 'INVALID_INPUT'
  );
});

test('capability reference: non-established friendship fails closed', () => {
  assert.throws(
    () => createCapabilityReference({
      friendship_record: { friendship_id: 'friendship:sha256:x', established: false },
      capability: { capability_id: 'c', name: 'n', summary: 's' }
    }),
    (e) => e && e.code === 'INVALID_FRIENDSHIP'
  );
});

test('capability reference: invalid capability input fails closed', () => {
  const fr = makeFriendshipRecord('s_cap_r_2');

  assert.throws(
    () => createCapabilityReference({ friendship_record: fr, capability: null }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createCapabilityReference({ friendship_record: fr, capability: { capability_id: 'c' } }),
    (e) => e && e.code === 'INVALID_INPUT'
  );
});

test('capability reference: deterministic output shape and values', () => {
  const fr = makeFriendshipRecord('s_cap_r_3');
  const cap = { capability_id: 'cap:sha256:test', name: 'ping', summary: 's' };

  const a = createCapabilityReference({ friendship_record: fr, capability: cap });
  const b = createCapabilityReference({ friendship_record: fr, capability: cap });

  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('capability reference: invocation_ready is true', () => {
  const fr = makeFriendshipRecord('s_cap_r_4');
  const cap = { capability_id: 'cap:sha256:test', name: 'ping', summary: 's' };

  const ref = createCapabilityReference({ friendship_record: fr, capability: cap });
  assert.equal(ref.invocation_ready, true);
});

test('capability reference: no task/mailbox/marketplace fields leak into the reference', () => {
  const fr = makeFriendshipRecord('s_cap_r_5');
  const cap = { capability_id: 'cap:sha256:test', name: 'ping', summary: 's' };

  const ref = createCapabilityReference({ friendship_record: fr, capability: cap });
  for (const k of Object.keys(ref)) {
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
    assert.ok(!k.includes('market'));
  }
});
