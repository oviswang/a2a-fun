import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscoveryCandidate, DISCOVERY_SOURCES } from '../src/discovery/discoveryCandidate.mjs';
import { evaluateDiscoveryCompatibility } from '../src/discovery/discoveryCompatibility.mjs';
import { createDiscoveryConversationPreview } from '../src/discovery/discoveryConversationPreview.mjs';
import { createDiscoveryInteraction } from '../src/discovery/discoveryInteraction.mjs';

import { createConversationOpeningMessage } from '../src/conversation/conversationOpeningMessage.mjs';
import { createConversationTurn, CONVERSATION_SPEAKERS } from '../src/conversation/conversationTurn.mjs';

test('conversation turn: valid opening + AGENT produces conversation turn', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer_turn_1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  const preview = createDiscoveryConversationPreview({ candidate, compatibility });
  const interaction = createDiscoveryInteraction({ preview });
  const opening = createConversationOpeningMessage({ interaction });

  const turn = createConversationTurn({ opening, speaker: CONVERSATION_SPEAKERS.AGENT });

  assert.deepEqual(Object.keys(turn), ['turn_id', 'opening_id', 'speaker', 'text', 'created_at']);
  assert.ok(turn.turn_id.startsWith('turn:sha256:'));
  assert.equal(turn.opening_id, opening.opening_id);
  assert.equal(turn.speaker, 'AGENT');
  assert.equal(turn.text, 'Hello, I can start with a lightweight introduction.');
  assert.equal(turn.created_at, new Date(0).toISOString());
});

test('conversation turn: valid opening + HUMAN produces conversation turn', () => {
  const opening = {
    opening_id: 'open:sha256:test',
    interaction_id: 'dint:sha256:test',
    text: 'x',
    created_at: new Date(0).toISOString()
  };

  const turn = createConversationTurn({ opening, speaker: CONVERSATION_SPEAKERS.HUMAN });
  assert.equal(turn.speaker, 'HUMAN');
  assert.equal(turn.text, 'Hi, I’m interested in learning more.');
});

test('conversation turn: invalid input fails closed', () => {
  assert.throws(
    () => createConversationTurn({ opening: null, speaker: 'AGENT' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createConversationTurn({ opening: { opening_id: 'x' }, speaker: 'AGENT' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  const opening = {
    opening_id: 'open:sha256:test',
    interaction_id: 'dint:sha256:test',
    text: 'x',
    created_at: new Date(0).toISOString()
  };

  assert.throws(
    () => createConversationTurn({ opening, speaker: '' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );
});

test('conversation turn: speaker allowlist enforced', () => {
  const opening = {
    opening_id: 'open:sha256:test',
    interaction_id: 'dint:sha256:test',
    text: 'x',
    created_at: new Date(0).toISOString()
  };

  assert.throws(
    () => createConversationTurn({ opening, speaker: 'NOPE' }),
    (e) => e && e.code === 'INVALID_SPEAKER'
  );
});

test('conversation turn: deterministic output shape', () => {
  const opening = {
    opening_id: 'open:sha256:test',
    interaction_id: 'dint:sha256:test',
    text: 'x',
    created_at: new Date(0).toISOString()
  };

  const a = createConversationTurn({ opening, speaker: 'AGENT' });
  const b = createConversationTurn({ opening, speaker: 'AGENT' });

  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('conversation turn: text remains bounded', () => {
  const opening = {
    opening_id: 'open:sha256:test',
    interaction_id: 'dint:sha256:test',
    text: 'x',
    created_at: new Date(0).toISOString()
  };

  const turn = createConversationTurn({ opening, speaker: 'AGENT' });
  assert.ok(turn.text.length > 0 && turn.text.length <= 200);
});

test('conversation turn: no capability/task/mailbox fields leak into the turn', () => {
  const opening = {
    opening_id: 'open:sha256:test',
    interaction_id: 'dint:sha256:test',
    text: 'x',
    created_at: new Date(0).toISOString()
  };

  const turn = createConversationTurn({ opening, speaker: 'AGENT' });
  for (const k of Object.keys(turn)) {
    assert.ok(!k.includes('capability'));
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
  }
});
