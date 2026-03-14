import test from 'node:test';
import assert from 'node:assert/strict';

import { createFriendshipCandidate } from '../src/friendship/friendshipCandidate.mjs';
import { confirmFriendshipCandidateLocally } from '../src/friendship/friendshipConfirmation.mjs';
import { confirmFriendshipCandidateRemotely } from '../src/friendship/friendshipRemoteConfirmation.mjs';
import { triggerFriendshipPersistence } from '../src/friendship/friendshipPersistenceTrigger.mjs';

test('friendship persistence trigger: valid mutually confirmed candidate produces friendship record', () => {
  const base = createFriendshipCandidate({ session_id: 's1', peer_actor_id: 'h:sha256:peer', phase3_state: 'PROBING' });
  const local = confirmFriendshipCandidateLocally({ candidate: base });
  const mutual = confirmFriendshipCandidateRemotely({ candidate: local });

  const rec = triggerFriendshipPersistence({ candidate: mutual });

  assert.equal(rec.established, true);
  assert.equal(rec.established_at, new Date(0).toISOString());
  assert.equal(rec.candidate_id, base.candidate_id);
  assert.equal(rec.session_id, 's1');
  assert.equal(rec.peer_actor_id, 'h:sha256:peer');
  assert.ok(rec.friendship_id.startsWith('friendship:sha256:'));
});

test('friendship persistence trigger: invalid candidate fails closed', () => {
  assert.throws(
    () => triggerFriendshipPersistence({ candidate: null }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => triggerFriendshipPersistence({ candidate: { candidate_id: 'x' } }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  const base = createFriendshipCandidate({ session_id: 's1', peer_actor_id: 'h:sha256:peer', phase3_state: 'PROBING' });
  const local = confirmFriendshipCandidateLocally({ candidate: base });

  // Not remotely confirmed -> fail
  assert.throws(
    () => triggerFriendshipPersistence({ candidate: { ...local, mutually_confirmed: false } }),
    (e) => e && e.code === 'ILLEGAL_STATE'
  );

  const mutual = confirmFriendshipCandidateRemotely({ candidate: local });

  // Tamper flags -> fail
  assert.throws(
    () => triggerFriendshipPersistence({ candidate: { ...mutual, remote_confirmed: false } }),
    (e) => e && e.code === 'ILLEGAL_STATE'
  );
});

test('friendship persistence trigger: deterministic output shape and no extra fields', () => {
  const base = createFriendshipCandidate({ session_id: 's1', peer_actor_id: 'h:sha256:peer', phase3_state: 'PROBING' });
  const mutual = confirmFriendshipCandidateRemotely({ candidate: confirmFriendshipCandidateLocally({ candidate: base }) });

  const a = triggerFriendshipPersistence({ candidate: mutual });
  const b = triggerFriendshipPersistence({ candidate: mutual });

  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a), [
    'friendship_id',
    'candidate_id',
    'session_id',
    'peer_actor_id',
    'established',
    'established_at'
  ]);

  // Ensure no capability/task/mailbox fields exist.
  for (const k of Object.keys(a)) {
    assert.ok(!k.includes('capability'));
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
  }
});
