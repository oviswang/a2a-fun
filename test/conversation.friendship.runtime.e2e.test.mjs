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

test('conversation->friendship runtime: handoff leads to Phase3 probe initiation (SESSION_PROBE_INIT) and friendship remains gated on PROBING', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer_cf_1',
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

  const out = startPhase3ProbeFromConversationHandoff({
    handoff,
    session_id: 'sess_cf_1',
    peer_actor_id: 'h:sha256:peer_remote'
  });

  assert.equal(out.ok, true);
  assert.equal(out.response.phase3_probe_started, true);
  assert.deepEqual(Object.keys(out.response), ['conversation_handoff', 'phase3_probe_started', 'phase3_probe_message']);
  assert.equal(out.response.phase3_probe_message.kind, 'SESSION_PROBE_INIT');

  assertNoCapabilityTaskMailboxLeak(out.response);
  assertNoCapabilityTaskMailboxLeak(out.response.conversation_handoff);

  // Phase3 semantics unchanged: INIT from NEW -> LOCAL_ENTERED (not PROBING yet).
  const st0 = { session_id: 'sess_cf_1', peer_actor_id: 'h:sha256:peer_remote', state: 'NEW', local_entered: false, remote_entered: false };
  const st1 = applySessionProbeMessage({ state: st0, message: out.response.phase3_probe_message });
  assert.equal(st1.state, 'LOCAL_ENTERED');

  // Friendship candidate creation remains gated on PROBING.
  const fc = maybeCreateFriendshipCandidateFromPhase3({ phase3_state: st1.state, session_id: st1.session_id, peer_actor_id: st1.peer_actor_id });
  assert.equal(fc, null);
});

test('conversation->friendship runtime: invalid conversation handoff fails closed', () => {
  assert.throws(
    () => startPhase3ProbeFromConversationHandoff({ handoff: null, session_id: 's', peer_actor_id: 'p' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  const bad = {
    handoff_id: 'x',
    surface_id: 'y',
    action: 'HANDOFF_TO_FRIENDSHIP',
    proceed: true,
    target: 'NOPE'
  };

  assert.throws(
    () => startPhase3ProbeFromConversationHandoff({ handoff: bad, session_id: 's', peer_actor_id: 'p' }),
    (e) => e && e.code === 'INVALID_HANDOFF'
  );
});
