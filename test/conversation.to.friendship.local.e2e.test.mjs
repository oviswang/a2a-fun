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

import { startPhase3ProbeFromConversationHandoff } from '../src/runtime/conversation/conversationHandoffToPhase3.mjs';
import { applySessionProbeMessage } from '../src/phase3/session/sessionStateTransition.mjs';
import { createFriendshipCandidate } from '../src/friendship/friendshipCandidate.mjs';

function assertNoCapabilityTaskMailboxLeak(obj) {
  for (const k of Object.keys(obj)) {
    assert.ok(!k.includes('capability'));
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
  }
}

function maybeCreateFriendshipCandidateFromPhase3({ phase3_state, session_id, peer_actor_id }) {
  if (phase3_state !== 'PROBING') return null;
  return createFriendshipCandidate({ session_id, peer_actor_id, phase3_state });
}

test('local Conversation → Friendship E2E (up to candidate gate): interaction -> opening -> turn -> transcript -> surface -> handoff -> Phase3 INIT -> state advance -> friendship still gated on PROBING', () => {
  // Minimal discovery interaction input.
  const dc = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer_ctf_1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const comp = evaluateDiscoveryCompatibility({ candidate: dc });
  const prev = createDiscoveryConversationPreview({ candidate: dc, compatibility: comp });
  const interaction = createDiscoveryInteraction({ preview: prev });

  // 1) opening
  const opening = createConversationOpeningMessage({ interaction });
  assert.ok(opening.opening_id);
  assertNoCapabilityTaskMailboxLeak(opening);

  // 2) turn
  const turn = createConversationTurn({ opening, speaker: 'AGENT' });
  assert.ok(turn.turn_id);
  assertNoCapabilityTaskMailboxLeak(turn);

  // 3) transcript
  const transcript = createConversationTranscript({ opening, turns: [turn] });
  assert.ok(transcript.transcript_id);
  assertNoCapabilityTaskMailboxLeak(transcript);

  // 4) surface
  const surface = createConversationSurface({ transcript });
  assert.ok(surface.surface_id);
  assertNoCapabilityTaskMailboxLeak(surface);

  // 5) HANDOFF_TO_FRIENDSHIP -> handoff
  const handoff = createConversationFriendshipHandoff({ surface, action: 'HANDOFF_TO_FRIENDSHIP' });
  assert.ok(handoff);
  assert.equal(handoff.target, 'FRIENDSHIP_TRIGGER');
  assert.equal(handoff.proceed, true);
  assertNoCapabilityTaskMailboxLeak(handoff);

  // 6) handoff -> Phase3 probe init
  const started = startPhase3ProbeFromConversationHandoff({
    handoff,
    session_id: 'sess_ctf_1',
    peer_actor_id: 'h:sha256:peer_remote'
  });
  assert.equal(started.ok, true);
  assert.equal(started.response.phase3_probe_started, true);
  assert.equal(started.response.phase3_probe_message.kind, 'SESSION_PROBE_INIT');
  assertNoCapabilityTaskMailboxLeak(started.response);

  // 7) INIT advances Phase3 state
  const st0 = { session_id: 'sess_ctf_1', peer_actor_id: 'h:sha256:peer_remote', state: 'NEW', local_entered: false, remote_entered: false };
  const st1 = applySessionProbeMessage({ state: st0, message: started.response.phase3_probe_message });
  assert.equal(st1.state, 'LOCAL_ENTERED');

  // 8) Friendship candidate still gated on PROBING
  const fc = maybeCreateFriendshipCandidateFromPhase3({ phase3_state: st1.state, session_id: st1.session_id, peer_actor_id: st1.peer_actor_id });
  assert.equal(fc, null);
});

test('local Conversation → Friendship E2E: SKIP and CONTINUE do not produce friendship handoff', () => {
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

test('local Conversation → Friendship E2E: invalid conversation/handoff input fails closed', () => {
  assert.throws(
    () => createConversationOpeningMessage({ interaction: null }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => startPhase3ProbeFromConversationHandoff({ handoff: null, session_id: 's', peer_actor_id: 'p' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => startPhase3ProbeFromConversationHandoff({
      handoff: { handoff_id: 'x', surface_id: 'y', action: 'HANDOFF_TO_FRIENDSHIP', proceed: true, target: 'NOPE' },
      session_id: 's',
      peer_actor_id: 'p'
    }),
    (e) => e && e.code === 'INVALID_HANDOFF'
  );
});
