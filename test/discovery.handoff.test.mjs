import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscoveryCandidate, DISCOVERY_SOURCES } from '../src/discovery/discoveryCandidate.mjs';
import { evaluateDiscoveryCompatibility } from '../src/discovery/discoveryCompatibility.mjs';
import { createDiscoveryConversationPreview } from '../src/discovery/discoveryConversationPreview.mjs';
import { createDiscoveryInteraction } from '../src/discovery/discoveryInteraction.mjs';
import { createDiscoveryFriendshipHandoff } from '../src/discovery/discoveryFriendshipHandoff.mjs';

test('discovery handoff: valid interaction + PROCEED produces handoff object', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  const preview = createDiscoveryConversationPreview({ candidate, compatibility });
  const interaction = createDiscoveryInteraction({ preview });

  const handoff = createDiscoveryFriendshipHandoff({ interaction, action: 'PROCEED' });

  assert.deepEqual(Object.keys(handoff), ['handoff_id', 'interaction_id', 'action', 'proceed', 'target']);
  assert.ok(handoff.handoff_id.startsWith('dhand:sha256:'));
  assert.equal(handoff.interaction_id, interaction.interaction_id);
  assert.equal(handoff.action, 'PROCEED');
  assert.equal(handoff.proceed, true);
  assert.equal(handoff.target, 'FRIENDSHIP_TRIGGER');
});

test('discovery handoff: SKIP does not produce friendship handoff', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  const preview = createDiscoveryConversationPreview({ candidate, compatibility });
  const interaction = createDiscoveryInteraction({ preview });

  const handoff = createDiscoveryFriendshipHandoff({ interaction, action: 'SKIP' });
  assert.equal(handoff, null);
});

test('discovery handoff: invalid input fails closed', () => {
  assert.throws(
    () => createDiscoveryFriendshipHandoff({ interaction: null, action: 'PROCEED' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createDiscoveryFriendshipHandoff({ interaction: { interaction_id: 'x', action_options: [], default_action: 'SKIP' }, action: '' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createDiscoveryFriendshipHandoff({ interaction: { interaction_id: 'x', action_options: [], default_action: 'SKIP' }, action: 'NOPE' }),
    (e) => e && e.code === 'INVALID_ACTION'
  );
});

test('discovery handoff: deterministic output shape (for PROCEED)', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  const preview = createDiscoveryConversationPreview({ candidate, compatibility });
  const interaction = createDiscoveryInteraction({ preview });

  const a = createDiscoveryFriendshipHandoff({ interaction, action: 'PROCEED' });
  const b = createDiscoveryFriendshipHandoff({ interaction, action: 'PROCEED' });

  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('discovery handoff: no capability/task/mailbox fields leak', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  const preview = createDiscoveryConversationPreview({ candidate, compatibility });
  const interaction = createDiscoveryInteraction({ preview });

  const handoff = createDiscoveryFriendshipHandoff({ interaction, action: 'PROCEED' });
  for (const k of Object.keys(handoff)) {
    assert.ok(!k.includes('capability'));
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
  }
});

test('discovery handoff: target remains fixed to FRIENDSHIP_TRIGGER', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  const preview = createDiscoveryConversationPreview({ candidate, compatibility });
  const interaction = createDiscoveryInteraction({ preview });

  const handoff = createDiscoveryFriendshipHandoff({ interaction, action: 'PROCEED' });
  assert.equal(handoff.target, 'FRIENDSHIP_TRIGGER');
});
