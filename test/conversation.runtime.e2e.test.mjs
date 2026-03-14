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

test('Conversation Runtime local E2E: discovery interaction -> opening -> turn -> transcript -> surface -> HANDOFF_TO_FRIENDSHIP -> handoff', () => {
  // Minimal discovery interaction input.
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer_conv_e2e_1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  const preview = createDiscoveryConversationPreview({ candidate, compatibility });
  const interaction = createDiscoveryInteraction({ preview });

  // 1) opening
  const opening = createConversationOpeningMessage({ interaction });
  assert.ok(opening.opening_id);

  // 2) turn
  const turn = createConversationTurn({ opening, speaker: 'AGENT' });
  assert.ok(turn.turn_id);

  // 3) transcript
  const transcript = createConversationTranscript({ opening, turns: [turn] });
  assert.ok(transcript.transcript_id);

  // 4) surface
  const surface = createConversationSurface({ transcript });
  assert.ok(surface.surface_id);

  // 5) handoff
  const handoff = createConversationFriendshipHandoff({ surface, action: 'HANDOFF_TO_FRIENDSHIP' });
  assert.ok(handoff);
  assert.equal(handoff.target, 'FRIENDSHIP_TRIGGER');
  assert.equal(handoff.proceed, true);
});

test('Conversation Runtime local E2E: SKIP/CONTINUE produce no handoff (null)', () => {
  const surface = {
    surface_id: 'surf:sha256:test',
    transcript_id: 'trans:sha256:test',
    summary: 'x',
    action_options: ['CONTINUE', 'SKIP', 'HANDOFF_TO_FRIENDSHIP'],
    default_action: 'SKIP'
  };

  assert.equal(createConversationFriendshipHandoff({ surface, action: 'SKIP' }), null);
  assert.equal(createConversationFriendshipHandoff({ surface, action: 'CONTINUE' }), null);
});

test('Conversation Runtime local E2E: invalid input fails closed', () => {
  assert.throws(
    () => createConversationOpeningMessage({ interaction: null }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createConversationTurn({ opening: null, speaker: 'AGENT' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createConversationSurface({ transcript: null }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createConversationFriendshipHandoff({ surface: null, action: 'HANDOFF_TO_FRIENDSHIP' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );
});

test('Conversation Runtime local E2E: deterministic output', () => {
  const interaction = {
    interaction_id: 'dint:sha256:test',
    preview_id: 'dprev:sha256:test',
    action_options: ['PROCEED', 'SKIP'],
    default_action: 'SKIP'
  };

  const openingA = createConversationOpeningMessage({ interaction });
  const openingB = createConversationOpeningMessage({ interaction });
  assert.deepEqual(openingA, openingB);

  const turnA = createConversationTurn({ opening: openingA, speaker: 'AGENT' });
  const turnB = createConversationTurn({ opening: openingB, speaker: 'AGENT' });
  assert.deepEqual(turnA, turnB);

  const transcriptA = createConversationTranscript({ opening: openingA, turns: [turnA] });
  const transcriptB = createConversationTranscript({ opening: openingB, turns: [turnB] });
  assert.deepEqual(transcriptA, transcriptB);

  const surfaceA = createConversationSurface({ transcript: transcriptA });
  const surfaceB = createConversationSurface({ transcript: transcriptB });
  assert.deepEqual(surfaceA, surfaceB);

  const handoffA = createConversationFriendshipHandoff({ surface: surfaceA, action: 'HANDOFF_TO_FRIENDSHIP' });
  const handoffB = createConversationFriendshipHandoff({ surface: surfaceB, action: 'HANDOFF_TO_FRIENDSHIP' });
  assert.deepEqual(handoffA, handoffB);
});
