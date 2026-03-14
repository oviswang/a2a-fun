import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscoveryCandidate, DISCOVERY_SOURCES } from '../src/discovery/discoveryCandidate.mjs';
import { evaluateDiscoveryCompatibility } from '../src/discovery/discoveryCompatibility.mjs';
import { createDiscoveryConversationPreview } from '../src/discovery/discoveryConversationPreview.mjs';
import { createDiscoveryInteraction } from '../src/discovery/discoveryInteraction.mjs';

import { createConversationOpeningMessage } from '../src/conversation/conversationOpeningMessage.mjs';
import { createConversationTurn } from '../src/conversation/conversationTurn.mjs';
import { createConversationTranscript } from '../src/conversation/conversationTranscript.mjs';
import {
  createConversationSurface,
  CONVERSATION_SURFACE_ACTIONS
} from '../src/conversation/conversationSurface.mjs';

test('conversation surface: valid transcript produces surface', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer_surf_1',
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

  assert.deepEqual(Object.keys(surface), [
    'surface_id',
    'transcript_id',
    'summary',
    'action_options',
    'default_action'
  ]);
  assert.ok(surface.surface_id.startsWith('surf:sha256:'));
  assert.equal(surface.transcript_id, transcript.transcript_id);
  assert.equal(surface.summary, 'A lightweight introduction is ready for review.');
  assert.deepEqual(surface.action_options, [
    CONVERSATION_SURFACE_ACTIONS.CONTINUE,
    CONVERSATION_SURFACE_ACTIONS.SKIP,
    CONVERSATION_SURFACE_ACTIONS.HANDOFF_TO_FRIENDSHIP
  ]);
  assert.equal(surface.default_action, CONVERSATION_SURFACE_ACTIONS.SKIP);
});

test('conversation surface: invalid input fails closed', () => {
  assert.throws(
    () => createConversationSurface({ transcript: null }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createConversationSurface({ transcript: { transcript_id: 'x' } }),
    (e) => e && e.code === 'INVALID_INPUT'
  );
});

test('conversation surface: deterministic output shape and values', () => {
  const transcript = {
    transcript_id: 'trans:sha256:test',
    opening_id: 'open:sha256:test',
    turns: [],
    created_at: new Date(0).toISOString()
  };

  const a = createConversationSurface({ transcript });
  const b = createConversationSurface({ transcript });

  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('conversation surface: action_options allowlist enforced (output fixed)', () => {
  const transcript = {
    transcript_id: 'trans:sha256:test',
    opening_id: 'open:sha256:test',
    turns: [],
    created_at: new Date(0).toISOString()
  };

  const surface = createConversationSurface({ transcript });
  assert.deepEqual(surface.action_options, [
    CONVERSATION_SURFACE_ACTIONS.CONTINUE,
    CONVERSATION_SURFACE_ACTIONS.SKIP,
    CONVERSATION_SURFACE_ACTIONS.HANDOFF_TO_FRIENDSHIP
  ]);
});

test('conversation surface: summary remains bounded', () => {
  const transcript = {
    transcript_id: 'trans:sha256:test',
    opening_id: 'open:sha256:test',
    turns: [],
    created_at: new Date(0).toISOString()
  };

  const surface = createConversationSurface({ transcript });
  assert.ok(surface.summary.length > 0 && surface.summary.length <= 200);
});

test('conversation surface: no capability/task/mailbox fields leak into the surface', () => {
  const transcript = {
    transcript_id: 'trans:sha256:test',
    opening_id: 'open:sha256:test',
    turns: [],
    created_at: new Date(0).toISOString()
  };

  const surface = createConversationSurface({ transcript });
  for (const k of Object.keys(surface)) {
    assert.ok(!k.includes('capability'));
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
  }
});
