import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscoveryCandidate, DISCOVERY_SOURCES } from '../src/discovery/discoveryCandidate.mjs';
import { evaluateDiscoveryCompatibility } from '../src/discovery/discoveryCompatibility.mjs';
import { createDiscoveryConversationPreview } from '../src/discovery/discoveryConversationPreview.mjs';
import { createDiscoveryInteraction } from '../src/discovery/discoveryInteraction.mjs';
import { createDiscoveryFriendshipHandoff } from '../src/discovery/discoveryFriendshipHandoff.mjs';

function assertNoCapabilityTaskMailboxLeak(obj) {
  for (const k of Object.keys(obj)) {
    assert.ok(!k.includes('capability'));
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
  }
}

test('Discovery Layer local E2E: known peer -> candidate -> compatibility -> preview -> interaction -> PROCEED -> friendship handoff', () => {
  // Smallest safe known-peer input.
  const knownPeerInput = {
    peer_actor_id: 'h:sha256:peer_e2e_1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  };

  const candidate = createDiscoveryCandidate(knownPeerInput);
  assert.ok(candidate.discovery_candidate_id);
  assert.equal(candidate.source, 'KNOWN_PEERS');
  assertNoCapabilityTaskMailboxLeak(candidate);

  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  assert.equal(compatibility.discovery_candidate_id, candidate.discovery_candidate_id);
  assert.ok(Number.isInteger(compatibility.score));
  assertNoCapabilityTaskMailboxLeak(compatibility);

  const preview = createDiscoveryConversationPreview({ candidate, compatibility });
  assert.equal(preview.discovery_candidate_id, candidate.discovery_candidate_id);
  assert.ok(preview.preview_id);
  assertNoCapabilityTaskMailboxLeak(preview);

  const interaction = createDiscoveryInteraction({ preview });
  assert.equal(interaction.preview_id, preview.preview_id);
  assert.ok(interaction.interaction_id);
  assertNoCapabilityTaskMailboxLeak(interaction);

  const handoff = createDiscoveryFriendshipHandoff({ interaction, action: 'PROCEED' });
  assert.ok(handoff);
  assert.equal(handoff.target, 'FRIENDSHIP_TRIGGER');
  assert.equal(handoff.proceed, true);
  assertNoCapabilityTaskMailboxLeak(handoff);
});

test('Discovery Layer local E2E: SKIP does not produce a handoff', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer_e2e_2',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  const preview = createDiscoveryConversationPreview({ candidate, compatibility });
  const interaction = createDiscoveryInteraction({ preview });

  const handoff = createDiscoveryFriendshipHandoff({ interaction, action: 'SKIP' });
  assert.equal(handoff, null);
});

test('Discovery Layer local E2E: invalid discovery input fails closed', () => {
  assert.throws(
    () => createDiscoveryCandidate({ peer_actor_id: '', peer_url: 'https://x', source: 'KNOWN_PEERS' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createDiscoveryCandidate({ peer_actor_id: 'h:sha256:p', peer_url: 'https://x', source: 'NOPE' }),
    (e) => e && e.code === 'INVALID_SOURCE'
  );
});
