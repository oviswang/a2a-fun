import test from 'node:test';
import assert from 'node:assert/strict';

import { createFriendshipCandidate } from '../src/friendship/friendshipCandidate.mjs';
import { confirmFriendshipCandidateLocally } from '../src/friendship/friendshipConfirmation.mjs';
import { confirmFriendshipCandidateRemotely } from '../src/friendship/friendshipRemoteConfirmation.mjs';

test('friendship remote confirmation: valid locally confirmed candidate can be remotely confirmed', () => {
  const base = createFriendshipCandidate({ session_id: 's1', peer_actor_id: 'h:sha256:peer', phase3_state: 'PROBING' });
  const local = confirmFriendshipCandidateLocally({ candidate: base });

  const out = confirmFriendshipCandidateRemotely({ candidate: local });

  assert.deepEqual(out, {
    candidate_id: base.candidate_id,
    session_id: 's1',
    peer_actor_id: 'h:sha256:peer',
    local_confirmed: true,
    remote_confirmed: true,
    mutually_confirmed: true,
    confirmed_at: new Date(0).toISOString()
  });
});

test('friendship remote confirmation: invalid candidate fails closed', () => {
  assert.throws(
    () => confirmFriendshipCandidateRemotely({ candidate: null }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  // missing required fields
  assert.throws(
    () => confirmFriendshipCandidateRemotely({ candidate: { candidate_id: 'x' } }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  const base = createFriendshipCandidate({ session_id: 's1', peer_actor_id: 'h:sha256:peer', phase3_state: 'PROBING' });

  // local_confirmed must be true
  assert.throws(
    () => confirmFriendshipCandidateRemotely({ candidate: base }),
    (e) => e && e.code === 'ILLEGAL_STATE'
  );

  const local = confirmFriendshipCandidateLocally({ candidate: base });

  // remote_confirmed must be false before this step
  assert.throws(
    () => confirmFriendshipCandidateRemotely({ candidate: { ...local, remote_confirmed: true } }),
    (e) => e && e.code === 'ILLEGAL_STATE'
  );
});

test('friendship remote confirmation: deterministic output shape', () => {
  const base = createFriendshipCandidate({ session_id: 's1', peer_actor_id: 'h:sha256:peer', phase3_state: 'PROBING' });
  const local = confirmFriendshipCandidateLocally({ candidate: base });

  const a = confirmFriendshipCandidateRemotely({ candidate: local });
  const b = confirmFriendshipCandidateRemotely({ candidate: local });

  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a), [
    'candidate_id',
    'session_id',
    'peer_actor_id',
    'local_confirmed',
    'remote_confirmed',
    'mutually_confirmed',
    'confirmed_at'
  ]);

  assert.equal(a.local_confirmed, true);
  assert.equal(a.remote_confirmed, true);
  assert.equal(a.mutually_confirmed, true);
});
