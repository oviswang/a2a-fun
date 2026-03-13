// Phase 3 module (builds on top of Phase 2)
// Minimal watcher/trigger glue: connects SessionManager results to friendshipWriter side-effects.
//
// Hard boundaries:
// - MUST NOT modify SessionManager
// - MUST NOT modify protocolProcessor behavior
// - MUST NOT modify friendshipWriter behavior
// - MUST NOT introduce retry/backoff here

export async function triggerFriendshipWriteIfNeeded({
  session_apply_result,
  peer_actor_id,
  peer_key_fpr,
  session_id,
  storage,
  auditBinder,
  friendshipWriter
}) {
  if (!session_apply_result) throw new Error('friendshipTrigger: missing session_apply_result');
  if (!session_apply_result.next_state) throw new Error('friendshipTrigger: missing session_apply_result.next_state');
  if (!friendshipWriter) throw new Error('friendshipTrigger: missing friendshipWriter');
  if (typeof friendshipWriter.writeFriendshipIfNeeded !== 'function') {
    throw new Error('friendshipTrigger: friendshipWriter.writeFriendshipIfNeeded missing');
  }

  const nextState = session_apply_result.next_state;
  if (nextState.state !== 'MUTUAL_ENTRY_CONFIRMED') {
    // No trigger. Machine-safe no-op.
    // Trigger layer does NOT emit separate audit yet (friendshipWriter emits audit on write).
    return {
      status: 'NO_TRIGGER',
      next_state: nextState,
      friendship: null
    };
  }

  const res = await friendshipWriter.writeFriendshipIfNeeded({
    sessionState: nextState,
    peer_actor_id,
    peer_key_fpr,
    session_id,
    storage,
    auditBinder
  });

  if (res.status === 'WROTE') {
    return {
      status: 'TRIGGERED_WRITE',
      next_state: nextState,
      friendship: {
        status: res.status,
        did_write: true
      }
    };
  }

  if (res.status === 'IDEMPOTENT_SKIP') {
    return {
      status: 'TRIGGERED_IDEMPOTENT',
      next_state: nextState,
      friendship: {
        status: res.status,
        did_write: false
      }
    };
  }

  // Should not happen given the explicit trigger condition check.
  throw new Error(`friendshipTrigger: unexpected friendshipWriter status: ${String(res.status)}`);
}
