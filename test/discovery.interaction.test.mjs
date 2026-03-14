import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscoveryCandidate, DISCOVERY_SOURCES } from '../src/discovery/discoveryCandidate.mjs';
import { evaluateDiscoveryCompatibility } from '../src/discovery/discoveryCompatibility.mjs';
import { createDiscoveryConversationPreview } from '../src/discovery/discoveryConversationPreview.mjs';
import {
  createDiscoveryInteraction,
  DISCOVERY_ACTIONS
} from '../src/discovery/discoveryInteraction.mjs';

test('discovery interaction: valid preview produces interaction object', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  const preview = createDiscoveryConversationPreview({ candidate, compatibility });

  const interaction = createDiscoveryInteraction({ preview });

  assert.deepEqual(Object.keys(interaction), [
    'interaction_id',
    'preview_id',
    'action_options',
    'default_action'
  ]);

  assert.ok(interaction.interaction_id.startsWith('dint:sha256:'));
  assert.equal(interaction.preview_id, preview.preview_id);
  assert.deepEqual(interaction.action_options, [DISCOVERY_ACTIONS.PROCEED, DISCOVERY_ACTIONS.SKIP]);
  assert.equal(interaction.default_action, DISCOVERY_ACTIONS.SKIP);
});

test('discovery interaction: invalid input fails closed', () => {
  assert.throws(
    () => createDiscoveryInteraction({ preview: null }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createDiscoveryInteraction({ preview: { preview_id: 'x' } }),
    (e) => e && e.code === 'INVALID_INPUT'
  );
});

test('discovery interaction: deterministic output shape and values', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  const preview = createDiscoveryConversationPreview({ candidate, compatibility });

  const a = createDiscoveryInteraction({ preview });
  const b = createDiscoveryInteraction({ preview });

  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('discovery interaction: action_options allowlist enforced (output fixed)', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  const preview = createDiscoveryConversationPreview({ candidate, compatibility });

  const interaction = createDiscoveryInteraction({ preview });
  assert.deepEqual(interaction.action_options, [DISCOVERY_ACTIONS.PROCEED, DISCOVERY_ACTIONS.SKIP]);
});

test('discovery interaction: no capability/task/mailbox fields leak', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  const preview = createDiscoveryConversationPreview({ candidate, compatibility });

  const interaction = createDiscoveryInteraction({ preview });

  for (const k of Object.keys(interaction)) {
    assert.ok(!k.includes('capability'));
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
  }
});

test('discovery interaction: default_action is deterministic', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  const preview = createDiscoveryConversationPreview({ candidate, compatibility });

  const interaction = createDiscoveryInteraction({ preview });
  assert.equal(interaction.default_action, DISCOVERY_ACTIONS.SKIP);
});
