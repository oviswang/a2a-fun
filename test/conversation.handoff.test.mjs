import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscoveryCandidate, DISCOVERY_SOURCES } from '../src/discovery/discoveryCandidate.mjs';
import { evaluateDiscoveryCompatibility } from '../src/discovery/discoveryCompatibility.mjs';
import { createDiscoveryConversationPreview } from '../src/discovery/discoveryConversationPreview.mjs';
import { createDiscoveryInteraction } from '../src/discovery/discoveryInteraction.mjs';

import { createConversationOpeningMessage } from '../src/conversation/conversationOpeningMessage.mjs';
import { createConversationTurn } from '../src/conversation/conversationTurn.mjs';
import { createConversationTranscript } from '../src/conversation/conversationTranscript.mjs';
import { createConversationSurface } from '../src/conversation/conversationSurface.mjs';

import { createConversationFriendshipHandoff } from '../src/conversation/conversationFriendshipHandoff.mjs';

test('conversation->friendship handoff: valid surface + HANDOFF_TO_FRIENDSHIP produces handoff object', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer_ch_1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  const preview = createDiscoveryConversationPreview({ candidate, compatibility });
  const interaction = createDiscoveryInteraction({ preview });
  const opening = createConversationOpeningMessage({ interaction });
  const t1 = createConversationTurn({ opening, speaker: 'AGENT' });
  const transcript = createConversationTranscript({ opening, turns: [t1] });
  const surface = createConversationSurface({ transcript });

  const handoff = createConversationFriendshipHandoff({ surface, action: 'HANDOFF_TO_FRIENDSHIP' });

  assert.deepEqual(Object.keys(handoff), ['handoff_id', 'surface_id', 'action', 'proceed', 'target']);
  assert.ok(handoff.handoff_id.startsWith('chand:sha256:'));
  assert.equal(handoff.surface_id, surface.surface_id);
  assert.equal(handoff.action, 'HANDOFF_TO_FRIENDSHIP');
  assert.equal(handoff.proceed, true);
  assert.equal(handoff.target, 'FRIENDSHIP_TRIGGER');
});

test('conversation->friendship handoff: SKIP produces no handoff (null)', () => {
  const surface = {
    surface_id: 'surf:sha256:test',
    transcript_id: 'trans:sha256:test',
    summary: 'x',
    action_options: ['CONTINUE', 'SKIP', 'HANDOFF_TO_FRIENDSHIP'],
    default_action: 'SKIP'
  };

  const handoff = createConversationFriendshipHandoff({ surface, action: 'SKIP' });
  assert.equal(handoff, null);
});

test('conversation->friendship handoff: CONTINUE produces no friendship handoff (null)', () => {
  const surface = {
    surface_id: 'surf:sha256:test',
    transcript_id: 'trans:sha256:test',
    summary: 'x',
    action_options: ['CONTINUE', 'SKIP', 'HANDOFF_TO_FRIENDSHIP'],
    default_action: 'SKIP'
  };

  const handoff = createConversationFriendshipHandoff({ surface, action: 'CONTINUE' });
  assert.equal(handoff, null);
});

test('conversation->friendship handoff: invalid input fails closed', () => {
  assert.throws(
    () => createConversationFriendshipHandoff({ surface: null, action: 'HANDOFF_TO_FRIENDSHIP' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  const surface = {
    surface_id: 'surf:sha256:test',
    transcript_id: 'trans:sha256:test',
    summary: 'x',
    action_options: ['CONTINUE', 'SKIP', 'HANDOFF_TO_FRIENDSHIP'],
    default_action: 'SKIP'
  };

  assert.throws(
    () => createConversationFriendshipHandoff({ surface, action: '' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createConversationFriendshipHandoff({ surface, action: 'NOPE' }),
    (e) => e && e.code === 'INVALID_ACTION'
  );
});

test('conversation->friendship handoff: deterministic output shape (for HANDOFF_TO_FRIENDSHIP)', () => {
  const surface = {
    surface_id: 'surf:sha256:test',
    transcript_id: 'trans:sha256:test',
    summary: 'x',
    action_options: ['CONTINUE', 'SKIP', 'HANDOFF_TO_FRIENDSHIP'],
    default_action: 'SKIP'
  };

  const a = createConversationFriendshipHandoff({ surface, action: 'HANDOFF_TO_FRIENDSHIP' });
  const b = createConversationFriendshipHandoff({ surface, action: 'HANDOFF_TO_FRIENDSHIP' });

  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('conversation->friendship handoff: no capability/task/mailbox fields leak into the handoff', () => {
  const surface = {
    surface_id: 'surf:sha256:test',
    transcript_id: 'trans:sha256:test',
    summary: 'x',
    action_options: ['CONTINUE', 'SKIP', 'HANDOFF_TO_FRIENDSHIP'],
    default_action: 'SKIP'
  };

  const handoff = createConversationFriendshipHandoff({ surface, action: 'HANDOFF_TO_FRIENDSHIP' });
  for (const k of Object.keys(handoff)) {
    assert.ok(!k.includes('capability'));
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
  }
});

test('conversation->friendship handoff: target remains fixed to FRIENDSHIP_TRIGGER', () => {
  const surface = {
    surface_id: 'surf:sha256:test',
    transcript_id: 'trans:sha256:test',
    summary: 'x',
    action_options: ['CONTINUE', 'SKIP', 'HANDOFF_TO_FRIENDSHIP'],
    default_action: 'SKIP'
  };

  const handoff = createConversationFriendshipHandoff({ surface, action: 'HANDOFF_TO_FRIENDSHIP' });
  assert.equal(handoff.target, 'FRIENDSHIP_TRIGGER');
});
