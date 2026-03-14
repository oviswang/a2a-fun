import test from 'node:test';
import assert from 'node:assert/strict';

import { createFriendshipCandidate } from '../src/friendship/friendshipCandidate.mjs';
import { confirmFriendshipCandidateLocally } from '../src/friendship/friendshipConfirmation.mjs';
import { confirmFriendshipCandidateRemotely } from '../src/friendship/friendshipRemoteConfirmation.mjs';
import { triggerFriendshipPersistence } from '../src/friendship/friendshipPersistenceTrigger.mjs';

import { createCapabilityAdvertisement } from '../src/capability/capabilityAdvertisement.mjs';
import { discoverCapabilities } from '../src/capability/capabilityDiscovery.mjs';
import { createCapabilityReference } from '../src/capability/capabilityReference.mjs';

function makeFriendshipRecord(session_id = 's_cap_e2e_1') {
  const cand = createFriendshipCandidate({ session_id, peer_actor_id: 'h:sha256:peer_cap_e2e_1', phase3_state: 'PROBING' });
  const local = confirmFriendshipCandidateLocally({ candidate: cand });
  const mutual = confirmFriendshipCandidateRemotely({ candidate: local });
  return triggerFriendshipPersistence({ candidate: mutual });
}

function assertNoTaskMailboxMarketplaceLeak(obj) {
  for (const k of Object.keys(obj)) {
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
    assert.ok(!k.includes('market'));
  }
}

test('Capability Sharing local E2E: friendship_record -> advertisement -> discovery -> capability reference', () => {
  const fr = makeFriendshipRecord();

  const ad = createCapabilityAdvertisement({
    friendship_record: fr,
    name: 'ping',
    summary: 'Responds with pong.',
    input_schema_ref: 'schema:ping:v1',
    output_schema_ref: 'schema:pong:v1'
  });
  assert.ok(ad.capability_id);
  assertNoTaskMailboxMarketplaceLeak(ad);

  const discovery = discoverCapabilities({ friendship_record: fr, advertisements: [ad] });
  assert.equal(discovery.friendship_id, fr.friendship_id);
  assert.equal(discovery.capabilities.length, 1);
  assertNoTaskMailboxMarketplaceLeak(discovery);

  const cap = discovery.capabilities[0];
  const ref = createCapabilityReference({ friendship_record: fr, capability: cap });
  assert.ok(ref.capability_ref_id);
  assert.equal(ref.invocation_ready, true);
  assertNoTaskMailboxMarketplaceLeak(ref);
});

test('Capability Sharing local E2E: discovery remains friendship-gated (mismatched ads excluded)', () => {
  const fr1 = makeFriendshipRecord('s_cap_e2e_2');
  const fr2 = makeFriendshipRecord('s_cap_e2e_3');

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

test('Capability Sharing local E2E: invalid friendship/capability inputs fail closed', () => {
  const fr = makeFriendshipRecord('s_cap_e2e_4');

  assert.throws(
    () => createCapabilityAdvertisement({ friendship_record: { friendship_id: fr.friendship_id, established: false }, name: 'n', summary: 's', input_schema_ref: 'i', output_schema_ref: 'o' }),
    (e) => e && e.code === 'INVALID_FRIENDSHIP'
  );

  assert.throws(
    () => discoverCapabilities({ friendship_record: null, advertisements: [] }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createCapabilityReference({ friendship_record: fr, capability: null }),
    (e) => e && e.code === 'INVALID_INPUT'
  );
});
