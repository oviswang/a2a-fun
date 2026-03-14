import test from 'node:test';
import assert from 'node:assert/strict';

import { createRemoteHumanJoinSignal } from '../src/social/remoteHumanJoinSignal.mjs';
import { sendRemoteHumanJoinSignal } from '../src/social/remoteHumanJoinSend.mjs';
import { handleRemoteHumanJoinSignal } from '../src/social/remoteHumanJoinReceive.mjs';

import { createHandoffState, applyLocalReplyAction } from '../src/social/socialHandoffState.mjs';
import { createTrustEdge } from '../src/social/socialTrustEdge.mjs';

test('remote human join flow: send result is deterministic and receive applies remote_human_joined', async () => {
  const c = createHandoffState({ handoff_id: 'h1' });
  assert.equal(c.ok, true);

  // local user joined first
  const local = applyLocalReplyAction({ handoff_state: c.handoff_state, action: 'join' });
  assert.equal(local.ok, true);
  assert.equal(local.handoff_state.local_human_joined, true);

  const sigOut = createRemoteHumanJoinSignal({
    handoff_id: local.handoff_state.handoff_id,
    from_agent_id: 'nodeA',
    to_agent_id: 'nodeB',
    created_at: '2026-03-14T00:00:00.000Z'
  });
  assert.equal(sigOut.ok, true);

  // transport stub: deliver directly to receiver handler
  const transport = async ({ payload }) => {
    const recv = handleRemoteHumanJoinSignal({ payload, handoff_state: local.handoff_state });
    assert.equal(recv.ok, true);
    assert.equal(recv.handoff_state.remote_human_joined, true);
    assert.equal(recv.friendship_established, true);
    return { ok: true, transport: 'relay' };
  };

  const sendOut = await sendRemoteHumanJoinSignal({
    transport,
    peer: { peerUrl: 'http://127.0.0.1:9/', relayAvailable: true },
    signal: sigOut.signal
  });

  assert.equal(sendOut.ok, true);
  assert.equal(sendOut.sent, true);

  // once friendship established, trust edge can be created
  const edge = createTrustEdge({ local_agent_id: 'nodeA', remote_agent_id: 'nodeB', established_at: '2026-03-14T00:00:00.000Z' });
  assert.equal(edge.ok, true);
  assert.equal(edge.trust_level, 1);
});
