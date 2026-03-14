import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscoveryCandidate, DISCOVERY_SOURCES } from '../src/discovery/discoveryCandidate.mjs';
import { evaluateDiscoveryCompatibility } from '../src/discovery/discoveryCompatibility.mjs';
import { createDiscoveryConversationPreview } from '../src/discovery/discoveryConversationPreview.mjs';
import { createDiscoveryInteraction } from '../src/discovery/discoveryInteraction.mjs';
import { createDiscoveryFriendshipHandoff } from '../src/discovery/discoveryFriendshipHandoff.mjs';

import { startPhase3ProbeFromDiscoveryHandoff } from '../src/runtime/discovery/discoveryHandoffToPhase3.mjs';
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
  // This mirrors the proven gating rule used by runtime wiring:
  // only create friendship candidate when Phase3 state is PROBING.
  if (phase3_state !== 'PROBING') return null;
  return createFriendshipCandidate({ session_id, peer_actor_id, phase3_state });
}

test('local Discovery → Friendship E2E (up to candidate gate): known peer -> discovery -> handoff -> Phase3 INIT -> state advance -> friendship candidate still gated on PROBING', () => {
  // 1) known peers input -> discovery candidate
  const discoveryCandidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer_dtfl_1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  assert.ok(discoveryCandidate.discovery_candidate_id);
  assertNoCapabilityTaskMailboxLeak(discoveryCandidate);

  // 2) compatibility
  const compatibility = evaluateDiscoveryCompatibility({ candidate: discoveryCandidate });
  assert.equal(compatibility.discovery_candidate_id, discoveryCandidate.discovery_candidate_id);
  assertNoCapabilityTaskMailboxLeak(compatibility);

  // 3) conversation preview
  const preview = createDiscoveryConversationPreview({ candidate: discoveryCandidate, compatibility });
  assert.equal(preview.discovery_candidate_id, discoveryCandidate.discovery_candidate_id);
  assert.ok(preview.preview_id);
  assertNoCapabilityTaskMailboxLeak(preview);

  // 4) interaction
  const interaction = createDiscoveryInteraction({ preview });
  assert.equal(interaction.preview_id, preview.preview_id);
  assert.ok(interaction.interaction_id);
  assertNoCapabilityTaskMailboxLeak(interaction);

  // 5) PROCEED -> handoff
  const handoff = createDiscoveryFriendshipHandoff({ interaction, action: 'PROCEED' });
  assert.ok(handoff);
  assert.equal(handoff.target, 'FRIENDSHIP_TRIGGER');
  assert.equal(handoff.proceed, true);
  assertNoCapabilityTaskMailboxLeak(handoff);

  // 6) handoff -> Phase3 probe init
  const started = startPhase3ProbeFromDiscoveryHandoff({
    handoff,
    session_id: 'sess_dtfl_1',
    peer_actor_id: 'h:sha256:peer_remote'
  });
  assert.equal(started.ok, true);
  assert.equal(started.response.phase3_probe_started, true);
  assert.equal(started.response.phase3_probe_message.kind, 'SESSION_PROBE_INIT');
  assertNoCapabilityTaskMailboxLeak(started.response);

  // 7) SESSION_PROBE_INIT advances Phase3 state
  const st0 = {
    session_id: 'sess_dtfl_1',
    peer_actor_id: 'h:sha256:peer_remote',
    state: 'NEW',
    local_entered: false,
    remote_entered: false
  };
  const st1 = applySessionProbeMessage({ state: st0, message: started.response.phase3_probe_message });
  assert.equal(st1.state, 'LOCAL_ENTERED');

  // 8) Friendship candidate is still gated on PROBING (not created here)
  const fc = maybeCreateFriendshipCandidateFromPhase3({
    phase3_state: st1.state,
    session_id: st1.session_id,
    peer_actor_id: st1.peer_actor_id
  });
  assert.equal(fc, null);
});

test('local Discovery → Friendship E2E: SKIP does not produce handoff (and thus cannot start probe)', () => {
  const discoveryCandidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer_dtfl_2',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate: discoveryCandidate });
  const preview = createDiscoveryConversationPreview({ candidate: discoveryCandidate, compatibility });
  const interaction = createDiscoveryInteraction({ preview });

  const handoff = createDiscoveryFriendshipHandoff({ interaction, action: 'SKIP' });
  assert.equal(handoff, null);

  assert.throws(
    () => startPhase3ProbeFromDiscoveryHandoff({ handoff, session_id: 's', peer_actor_id: 'p' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );
});

test('local Discovery → Friendship E2E: invalid discovery/handoff input fails closed', () => {
  assert.throws(
    () => createDiscoveryCandidate({ peer_actor_id: 'h:sha256:p', peer_url: 'https://x', source: 'NOPE' }),
    (e) => e && e.code === 'INVALID_SOURCE'
  );

  assert.throws(
    () => startPhase3ProbeFromDiscoveryHandoff({
      handoff: {
        handoff_id: 'x',
        interaction_id: 'y',
        action: 'PROCEED',
        proceed: true,
        target: 'NOPE'
      },
      session_id: 's',
      peer_actor_id: 'p'
    }),
    (e) => e && e.code === 'INVALID_HANDOFF'
  );
});
