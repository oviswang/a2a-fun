import test from 'node:test';
import assert from 'node:assert/strict';

import { handleRelayInbound } from '../src/runtime/inbound/relayInbound.mjs';
import { createRemoteHumanJoinSignal } from '../src/social/remoteHumanJoinSignal.mjs';
import { createHandoffState, applyLocalReplyAction } from '../src/social/socialHandoffState.mjs';
import { handleInboundRemoteHumanJoin } from '../src/social/remoteHumanJoinInboundWiring.mjs';

test('inbound dispatch: relayInbound dispatches REMOTE_HUMAN_JOIN_SIGNAL when hook provided', async () => {
  let called = false;

  const sigOut = createRemoteHumanJoinSignal({
    handoff_id: 'h1',
    from_agent_id: 'nodeB',
    to_agent_id: 'nodeA',
    created_at: '2026-03-14T00:00:00.000Z'
  });
  assert.equal(sigOut.ok, true);

  const msg = {
    from: 'nodeB',
    payload: { kind: 'REMOTE_HUMAN_JOIN_SIGNAL', signal: sigOut.signal }
  };

  await handleRelayInbound(msg, {
    onInbound: async () => {
      throw new Error('should not reach onInbound');
    },
    onRemoteHumanJoinSignal: async ({ payload, from }) => {
      called = true;
      assert.equal(from, 'nodeB');
      assert.equal(payload.kind, 'REMOTE_HUMAN_JOIN_SIGNAL');
      return { ok: true };
    }
  });

  assert.equal(called, true);
});

test('inbound wiring: remote join updates state and can establish friendship + trust edge', () => {
  const c = createHandoffState({ handoff_id: 'h1' });
  assert.equal(c.ok, true);

  // local already joined
  const local = applyLocalReplyAction({ handoff_state: c.handoff_state, action: 'join' });
  assert.equal(local.ok, true);

  const sigOut = createRemoteHumanJoinSignal({
    handoff_id: local.handoff_state.handoff_id,
    from_agent_id: 'nodeB',
    to_agent_id: 'nodeA',
    created_at: '2026-03-14T00:00:00.000Z'
  });
  assert.equal(sigOut.ok, true);

  const out = handleInboundRemoteHumanJoin({
    payload: { kind: 'REMOTE_HUMAN_JOIN_SIGNAL', signal: sigOut.signal },
    handoff_state: local.handoff_state,
    local_agent_id: 'nodeA',
    remote_agent_id: 'nodeB'
  });

  assert.equal(out.ok, true);
  assert.equal(out.handoff_state.remote_human_joined, true);
  assert.equal(out.friendship_established, true);
  assert.equal(out.trust_edge?.ok, true);
  assert.equal(out.trust_edge?.trust_level, 1);
});
