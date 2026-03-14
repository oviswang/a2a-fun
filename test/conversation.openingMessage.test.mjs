import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscoveryCandidate, DISCOVERY_SOURCES } from '../src/discovery/discoveryCandidate.mjs';
import { evaluateDiscoveryCompatibility } from '../src/discovery/discoveryCompatibility.mjs';
import { createDiscoveryConversationPreview } from '../src/discovery/discoveryConversationPreview.mjs';
import { createDiscoveryInteraction } from '../src/discovery/discoveryInteraction.mjs';

import { createConversationOpeningMessage } from '../src/conversation/conversationOpeningMessage.mjs';

test('conversation opening message: valid interaction produces opening message', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer_conv_1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  const preview = createDiscoveryConversationPreview({ candidate, compatibility });
  const interaction = createDiscoveryInteraction({ preview });

  const opening = createConversationOpeningMessage({ interaction });

  assert.deepEqual(Object.keys(opening), ['opening_id', 'interaction_id', 'text', 'created_at']);
  assert.ok(opening.opening_id.startsWith('open:sha256:'));
  assert.equal(opening.interaction_id, interaction.interaction_id);
  assert.equal(opening.created_at, new Date(0).toISOString());
});

test('conversation opening message: invalid input fails closed', () => {
  assert.throws(
    () => createConversationOpeningMessage({ interaction: null }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createConversationOpeningMessage({ interaction: {} }),
    (e) => e && e.code === 'INVALID_INPUT'
  );
});

test('conversation opening message: deterministic output shape and values', () => {
  const interaction = { interaction_id: 'dint:sha256:test', action_options: ['PROCEED', 'SKIP'], default_action: 'SKIP', preview_id: 'x' };
  const a = createConversationOpeningMessage({ interaction });
  const b = createConversationOpeningMessage({ interaction });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('conversation opening message: text remains bounded', () => {
  const interaction = { interaction_id: 'dint:sha256:test', action_options: ['PROCEED', 'SKIP'], default_action: 'SKIP', preview_id: 'x' };
  const opening = createConversationOpeningMessage({ interaction });
  assert.equal(typeof opening.text, 'string');
  assert.ok(opening.text.length > 0 && opening.text.length <= 200);
});

test('conversation opening message: no capability/task/mailbox fields leak', () => {
  const interaction = { interaction_id: 'dint:sha256:test', action_options: ['PROCEED', 'SKIP'], default_action: 'SKIP', preview_id: 'x' };
  const opening = createConversationOpeningMessage({ interaction });
  for (const k of Object.keys(opening)) {
    assert.ok(!k.includes('capability'));
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
  }
});
