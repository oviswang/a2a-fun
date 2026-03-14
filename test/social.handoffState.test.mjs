import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createHandoffState,
  applyLocalReplyAction,
  applyRemoteJoinSignal,
  shouldEstablishFriendship
} from '../src/social/socialHandoffState.mjs';

test('handoff state: deterministic transitions and friendship establishment only when both join', () => {
  const c = createHandoffState({ handoff_id: 'h1' });
  assert.equal(c.ok, true);

  let st = c.handoff_state;
  assert.equal(st.friendship_established, false);

  // local join only: not established
  st = applyLocalReplyAction({ handoff_state: st, action: 'join' }).handoff_state;
  assert.equal(st.local_human_joined, true);
  assert.equal(st.friendship_established, false);

  // remote join: now established
  st = applyRemoteJoinSignal({ handoff_state: st }).handoff_state;
  assert.equal(st.remote_human_joined, true);
  assert.equal(st.friendship_established, true);

  const fr = shouldEstablishFriendship({ handoff_state: st });
  assert.equal(fr.ok, true);
  assert.equal(fr.friendship_established, true);
});

test('handoff state: invalid input fails closed', () => {
  assert.equal(createHandoffState({ handoff_id: '' }).ok, false);
  assert.equal(applyLocalReplyAction({ handoff_state: null, action: 'join' }).ok, false);
  assert.equal(applyRemoteJoinSignal({ handoff_state: null }).ok, false);
});
