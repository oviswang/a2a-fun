import test from 'node:test';
import assert from 'node:assert/strict';

import { applySessionProbeMessage } from '../src/phase3/session/sessionStateTransition.mjs';
import { SESSION_PROBE_KINDS_PHASE3 } from '../src/phase3/session/sessionProbeKinds.mjs';

import { createFriendshipCandidate } from '../src/friendship/friendshipCandidate.mjs';
import { confirmFriendshipCandidateLocally } from '../src/friendship/friendshipConfirmation.mjs';
import { confirmFriendshipCandidateRemotely } from '../src/friendship/friendshipRemoteConfirmation.mjs';
import { triggerFriendshipPersistence } from '../src/friendship/friendshipPersistenceTrigger.mjs';

function maybeCreateCandidateFromPhase3Success({ phase3_state, session_id, peer_actor_id }) {
  // This is the minimal Friendship Trigger gating rule for this E2E validation:
  // only create candidate after Phase 3 success state === PROBING.
  if (phase3_state !== 'PROBING') return null;
  return createFriendshipCandidate({ session_id, peer_actor_id, phase3_state });
}

test('Friendship Trigger Layer (minimal) local E2E: Phase3 PROBING -> candidate -> local confirm -> remote confirm -> persistence record', () => {
  const session_id = 'sess_e2e_1';
  const peer_actor_id = 'h:sha256:peer_e2e_1';

  // Phase 3 success (same-machine) minimal path: NEW -> LOCAL_ENTERED -> PROBING
  const st0 = { session_id, peer_actor_id, state: 'NEW', local_entered: false, remote_entered: false };

  const st1 = applySessionProbeMessage({
    state: st0,
    message: { kind: SESSION_PROBE_KINDS_PHASE3.SESSION_PROBE_INIT, session_id, peer_actor_id }
  });
  assert.equal(st1.state, 'LOCAL_ENTERED');

  const st2 = applySessionProbeMessage({
    state: st1,
    message: { kind: SESSION_PROBE_KINDS_PHASE3.SESSION_PROBE_ACK, session_id, peer_actor_id }
  });
  assert.equal(st2.state, 'PROBING');

  // Candidate created only after Phase 3 PROBING.
  const candidate = maybeCreateCandidateFromPhase3Success({
    phase3_state: st2.state,
    session_id: st2.session_id,
    peer_actor_id: st2.peer_actor_id
  });

  assert.ok(candidate);
  assert.equal(candidate.phase3_state, 'PROBING');
  assert.equal(candidate.local_confirmed, false);
  assert.equal(candidate.remote_confirmed, false);

  // Local confirm succeeds.
  const localConfirmed = confirmFriendshipCandidateLocally({ candidate });
  assert.equal(localConfirmed.local_confirmed, true);
  assert.equal(localConfirmed.remote_confirmed, false);

  // Remote confirm succeeds (mutual).
  const mutuallyConfirmed = confirmFriendshipCandidateRemotely({ candidate: localConfirmed });
  assert.equal(mutuallyConfirmed.local_confirmed, true);
  assert.equal(mutuallyConfirmed.remote_confirmed, true);
  assert.equal(mutuallyConfirmed.mutually_confirmed, true);

  // Persistence trigger returns a machine-safe friendship record (no side-effects here).
  const rec = triggerFriendshipPersistence({ candidate: mutuallyConfirmed });
  assert.deepEqual(Object.keys(rec), [
    'friendship_id',
    'candidate_id',
    'session_id',
    'peer_actor_id',
    'established',
    'established_at'
  ]);
  assert.ok(rec.friendship_id.startsWith('friendship:sha256:'));
  assert.equal(rec.established, true);
  assert.equal(rec.established_at, new Date(0).toISOString());

  // No capability/task/mailbox side-effects: record is minimal and contains no such fields.
  for (const k of Object.keys(rec)) {
    assert.ok(!k.includes('capability'));
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
  }
});

test('Friendship Trigger Layer (minimal) E2E: candidate creation is gated on Phase3 state === PROBING', () => {
  const session_id = 'sess_e2e_gate_1';
  const peer_actor_id = 'h:sha256:peer_e2e_gate_1';

  const st0 = { session_id, peer_actor_id, state: 'NEW', local_entered: false, remote_entered: false };

  // NEW should not create candidate.
  assert.equal(
    maybeCreateCandidateFromPhase3Success({ phase3_state: st0.state, session_id, peer_actor_id }),
    null
  );

  // LOCAL_ENTERED should not create candidate.
  const st1 = applySessionProbeMessage({
    state: st0,
    message: { kind: SESSION_PROBE_KINDS_PHASE3.SESSION_PROBE_INIT, session_id, peer_actor_id }
  });
  assert.equal(st1.state, 'LOCAL_ENTERED');
  assert.equal(
    maybeCreateCandidateFromPhase3Success({ phase3_state: st1.state, session_id, peer_actor_id }),
    null
  );

  // PROBING should create candidate.
  const st2 = applySessionProbeMessage({
    state: st1,
    message: { kind: SESSION_PROBE_KINDS_PHASE3.SESSION_PROBE_ACK, session_id, peer_actor_id }
  });
  assert.equal(st2.state, 'PROBING');
  const candidate = maybeCreateCandidateFromPhase3Success({ phase3_state: st2.state, session_id, peer_actor_id });
  assert.ok(candidate);
  assert.equal(candidate.phase3_state, 'PROBING');
});

test('Friendship Trigger Layer (minimal) E2E: invalid/incomplete confirmation fails closed (persistence trigger)', () => {
  const session_id = 'sess_e2e_fail_1';
  const peer_actor_id = 'h:sha256:peer_e2e_fail_1';

  const candidate = createFriendshipCandidate({ session_id, peer_actor_id, phase3_state: 'PROBING' });

  // Attempt persistence without mutual confirmation must fail closed.
  assert.throws(
    () => triggerFriendshipPersistence({ candidate }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  const localConfirmed = confirmFriendshipCandidateLocally({ candidate });
  assert.throws(
    () => triggerFriendshipPersistence({ candidate: localConfirmed }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  const mutuallyConfirmed = confirmFriendshipCandidateRemotely({ candidate: localConfirmed });
  const ok = triggerFriendshipPersistence({ candidate: mutuallyConfirmed });
  assert.equal(ok.established, true);

  // Tamper confirmed flags -> fail closed.
  assert.throws(
    () => triggerFriendshipPersistence({ candidate: { ...mutuallyConfirmed, remote_confirmed: false } }),
    (e) => e && e.code === 'ILLEGAL_STATE'
  );
});
