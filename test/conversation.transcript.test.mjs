import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscoveryCandidate, DISCOVERY_SOURCES } from '../src/discovery/discoveryCandidate.mjs';
import { evaluateDiscoveryCompatibility } from '../src/discovery/discoveryCompatibility.mjs';
import { createDiscoveryConversationPreview } from '../src/discovery/discoveryConversationPreview.mjs';
import { createDiscoveryInteraction } from '../src/discovery/discoveryInteraction.mjs';

import { createConversationOpeningMessage } from '../src/conversation/conversationOpeningMessage.mjs';
import { createConversationTurn } from '../src/conversation/conversationTurn.mjs';
import { createConversationTranscript } from '../src/conversation/conversationTranscript.mjs';

test('conversation transcript: valid opening + turns produce transcript', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer_tr_1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  const preview = createDiscoveryConversationPreview({ candidate, compatibility });
  const interaction = createDiscoveryInteraction({ preview });
  const opening = createConversationOpeningMessage({ interaction });

  const t1 = createConversationTurn({ opening, speaker: 'AGENT' });
  const t2 = createConversationTurn({ opening, speaker: 'HUMAN' });

  const transcript = createConversationTranscript({ opening, turns: [t1, t2] });

  assert.deepEqual(Object.keys(transcript), ['transcript_id', 'opening_id', 'turns', 'created_at']);
  assert.ok(transcript.transcript_id.startsWith('trans:sha256:'));
  assert.equal(transcript.opening_id, opening.opening_id);
  assert.equal(transcript.created_at, new Date(0).toISOString());
  assert.equal(transcript.turns.length, 2);
  assert.equal(transcript.turns[0].turn_id, t1.turn_id);
  assert.equal(transcript.turns[1].turn_id, t2.turn_id);
});

test('conversation transcript: invalid input fails closed', () => {
  assert.throws(
    () => createConversationTranscript({ opening: null, turns: [] }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  const opening = {
    opening_id: 'open:sha256:test',
    interaction_id: 'dint:sha256:test',
    text: 'x',
    created_at: new Date(0).toISOString()
  };

  assert.throws(
    () => createConversationTranscript({ opening, turns: null }),
    (e) => e && e.code === 'INVALID_INPUT'
  );
});

test('conversation transcript: mismatched opening_id fails closed', () => {
  const opening = {
    opening_id: 'open:sha256:one',
    interaction_id: 'dint:sha256:test',
    text: 'x',
    created_at: new Date(0).toISOString()
  };

  const badTurn = {
    turn_id: 'turn:sha256:bad',
    opening_id: 'open:sha256:two',
    speaker: 'AGENT',
    text: 'x',
    created_at: new Date(0).toISOString()
  };

  assert.throws(
    () => createConversationTranscript({ opening, turns: [badTurn] }),
    (e) => e && e.code === 'MISMATCH'
  );
});

test('conversation transcript: bounded turn limit enforced (max 4)', () => {
  const opening = {
    opening_id: 'open:sha256:one',
    interaction_id: 'dint:sha256:test',
    text: 'x',
    created_at: new Date(0).toISOString()
  };

  const mk = (n) => ({
    turn_id: `turn:sha256:${n}`,
    opening_id: opening.opening_id,
    speaker: 'AGENT',
    text: 'x',
    created_at: new Date(0).toISOString()
  });

  assert.throws(
    () => createConversationTranscript({ opening, turns: [mk(1), mk(2), mk(3), mk(4), mk(5)] }),
    (e) => e && e.code === 'TOO_MANY_TURNS'
  );
});

test('conversation transcript: deterministic output shape and values', () => {
  const opening = {
    opening_id: 'open:sha256:one',
    interaction_id: 'dint:sha256:test',
    text: 'x',
    created_at: new Date(0).toISOString()
  };

  const t1 = {
    turn_id: 'turn:sha256:1',
    opening_id: opening.opening_id,
    speaker: 'AGENT',
    text: 'x',
    created_at: new Date(0).toISOString()
  };

  const a = createConversationTranscript({ opening, turns: [t1] });
  const b = createConversationTranscript({ opening, turns: [t1] });

  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('conversation transcript: no capability/task/mailbox fields leak into the transcript', () => {
  const opening = {
    opening_id: 'open:sha256:one',
    interaction_id: 'dint:sha256:test',
    text: 'x',
    created_at: new Date(0).toISOString()
  };

  const t1 = {
    turn_id: 'turn:sha256:1',
    opening_id: opening.opening_id,
    speaker: 'AGENT',
    text: 'x',
    created_at: new Date(0).toISOString()
  };

  const transcript = createConversationTranscript({ opening, turns: [t1] });

  for (const k of Object.keys(transcript)) {
    assert.ok(!k.includes('capability'));
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
  }
});
