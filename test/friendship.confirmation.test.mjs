import test from 'node:test';
import assert from 'node:assert/strict';

import { createFriendshipCandidate } from '../src/friendship/friendshipCandidate.mjs';
import { confirmFriendshipCandidateLocally } from '../src/friendship/friendshipConfirmation.mjs';

test('friendship confirmation: valid candidate can be locally confirmed', () => {
  const candidate = createFriendshipCandidate({ session_id: 's1', peer_actor_id: 'h:sha256:peer', phase3_state: 'PROBING' });

  const out = confirmFriendshipCandidateLocally({ candidate });

  assert.deepEqual(out, {
    candidate_id: candidate.candidate_id,
    session_id: 's1',
    peer_actor_id: 'h:sha256:peer',
    local_confirmed: true,
    remote_confirmed: false,
    confirmed_at: new Date(0).toISOString()
  });
});

test('friendship confirmation: invalid candidate fails closed', () => {
  assert.throws(
    () => confirmFriendshipCandidateLocally({ candidate: null }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => confirmFriendshipCandidateLocally({ candidate: { candidate_id: 'x' } }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  // Already confirmed -> fail closed
  const candidate = createFriendshipCandidate({ session_id: 's1', peer_actor_id: 'h:sha256:peer', phase3_state: 'PROBING' });
  assert.throws(
    () => confirmFriendshipCandidateLocally({ candidate: { ...candidate, local_confirmed: true } }),
    (e) => e && e.code === 'ILLEGAL_STATE'
  );

  // remote_confirmed must remain false in this phase
  assert.throws(
    () => confirmFriendshipCandidateLocally({ candidate: { ...candidate, remote_confirmed: true } }),
    (e) => e && e.code === 'ILLEGAL_STATE'
  );
});

test('friendship confirmation: deterministic output shape', () => {
  const candidate = createFriendshipCandidate({ session_id: 's1', peer_actor_id: 'h:sha256:peer', phase3_state: 'PROBING' });

  const a = confirmFriendshipCandidateLocally({ candidate });
  const b = confirmFriendshipCandidateLocally({ candidate });

  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a), [
    'candidate_id',
    'session_id',
    'peer_actor_id',
    'local_confirmed',
    'remote_confirmed',
    'confirmed_at'
  ]);

  assert.equal(a.local_confirmed, true);
  assert.equal(a.remote_confirmed, false);
});
