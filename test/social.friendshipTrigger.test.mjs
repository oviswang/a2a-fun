import test from 'node:test';
import assert from 'node:assert/strict';

import { applyHumanJoinFriendshipRule } from '../src/social/socialFriendshipTrigger.mjs';


test('friendship trigger: establishes only when both sides joined', () => {
  const st1 = {
    handoff_id: 'h',
    local_human_joined: true,
    remote_human_joined: false,
    friendship_established: false
  };
  const out1 = applyHumanJoinFriendshipRule({ handoff_state: st1 });
  assert.equal(out1.ok, true);
  assert.equal(out1.friendship_established, false);

  const st2 = { ...st1, remote_human_joined: true };
  const out2 = applyHumanJoinFriendshipRule({ handoff_state: st2 });
  assert.equal(out2.ok, true);
  assert.equal(out2.friendship_established, true);
});
