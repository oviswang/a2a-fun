import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscoveryCandidate, DISCOVERY_SOURCES } from '../src/discovery/discoveryCandidate.mjs';
import { evaluateDiscoveryCompatibility } from '../src/discovery/discoveryCompatibility.mjs';
import { createDiscoveryConversationPreview } from '../src/discovery/discoveryConversationPreview.mjs';
import { createDiscoveryInteraction } from '../src/discovery/discoveryInteraction.mjs';
import { createDiscoveryFriendshipHandoff } from '../src/discovery/discoveryFriendshipHandoff.mjs';

import { startPhase3ProbeFromDiscoveryHandoff } from '../src/runtime/discovery/discoveryHandoffToPhase3.mjs';
import { applySessionProbeMessage } from '../src/phase3/session/sessionStateTransition.mjs';

function assertNoCapabilityTaskMailboxLeak(obj) {
  for (const k of Object.keys(obj)) {
    assert.ok(!k.includes('capability'));
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
  }
}

test('discovery->friendship runtime: handoff leads to Phase3 probe initiation (SESSION_PROBE_INIT)', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer_df_1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  const preview = createDiscoveryConversationPreview({ candidate, compatibility });
  const interaction = createDiscoveryInteraction({ preview });

  const handoff = createDiscoveryFriendshipHandoff({ interaction, action: 'PROCEED' });

  const out = startPhase3ProbeFromDiscoveryHandoff({
    handoff,
    session_id: 'sess_df_1',
    peer_actor_id: 'h:sha256:peer_remote'
  });

  assert.equal(out.ok, true);
  assert.equal(out.response.phase3_probe_started, true);
  assert.deepEqual(Object.keys(out.response), ['discovery_handoff', 'phase3_probe_started', 'phase3_probe_message']);
  assert.equal(out.response.phase3_probe_message.kind, 'SESSION_PROBE_INIT');

  assertNoCapabilityTaskMailboxLeak(out.response);
  assertNoCapabilityTaskMailboxLeak(out.response.discovery_handoff);

  // Phase3 semantics unchanged: INIT from NEW -> LOCAL_ENTERED (not PROBING yet).
  const st0 = { session_id: 'sess_df_1', peer_actor_id: 'h:sha256:peer_remote', state: 'NEW', local_entered: false, remote_entered: false };
  const st1 = applySessionProbeMessage({ state: st0, message: out.response.phase3_probe_message });
  assert.equal(st1.state, 'LOCAL_ENTERED');

  // Friendship candidate creation still requires PROBING (not reached here).
  assert.notEqual(st1.state, 'PROBING');
});

test('discovery->friendship runtime: invalid discovery handoff fails closed', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer_df_2',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  const preview = createDiscoveryConversationPreview({ candidate, compatibility });
  const interaction = createDiscoveryInteraction({ preview });

  // SKIP creates no handoff, wiring must fail closed when given null.
  const handoff = createDiscoveryFriendshipHandoff({ interaction, action: 'SKIP' });
  assert.equal(handoff, null);

  assert.throws(
    () => startPhase3ProbeFromDiscoveryHandoff({ handoff, session_id: 's', peer_actor_id: 'p' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  // Wrong target fails closed.
  const bad = createDiscoveryFriendshipHandoff({ interaction, action: 'PROCEED' });
  const bad2 = { ...bad, target: 'NOPE' };
  assert.throws(
    () => startPhase3ProbeFromDiscoveryHandoff({ handoff: bad2, session_id: 's', peer_actor_id: 'p' }),
    (e) => e && e.code === 'INVALID_HANDOFF'
  );
});

test('discovery->friendship runtime: deterministic machine-safe output', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer_df_3',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });
  const preview = createDiscoveryConversationPreview({ candidate, compatibility });
  const interaction = createDiscoveryInteraction({ preview });
  const handoff = createDiscoveryFriendshipHandoff({ interaction, action: 'PROCEED' });

  const a = startPhase3ProbeFromDiscoveryHandoff({ handoff, session_id: 'sess_df_3', peer_actor_id: 'h:sha256:peer_remote' });
  const b = startPhase3ProbeFromDiscoveryHandoff({ handoff, session_id: 'sess_df_3', peer_actor_id: 'h:sha256:peer_remote' });

  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
