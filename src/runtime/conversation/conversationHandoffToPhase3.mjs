// Runtime wiring: Conversation -> Phase3 probe initiation (handoff only)
//
// Hard constraints:
// - does NOT modify transport/protocol/envelope semantics
// - does NOT modify Phase3 semantics
// - does NOT create friendships directly
// - no networking, no persistence, no orchestration

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function assertNonEmptyString(v, name) {
  if (typeof v !== 'string' || v.trim() === '') throw err('INVALID_INPUT', `missing ${name}`);
}

function assertHandoff(handoff) {
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) throw err('INVALID_INPUT', 'handoff must be object');
  assertNonEmptyString(handoff.handoff_id, 'handoff.handoff_id');
  assertNonEmptyString(handoff.surface_id, 'handoff.surface_id');
  assertNonEmptyString(handoff.action, 'handoff.action');
  if (handoff.proceed !== true) throw err('INVALID_HANDOFF', 'handoff.proceed must be true');
  if (handoff.target !== 'FRIENDSHIP_TRIGGER') throw err('INVALID_HANDOFF', 'handoff.target must be FRIENDSHIP_TRIGGER');
  if (handoff.action !== 'HANDOFF_TO_FRIENDSHIP') throw err('INVALID_HANDOFF', 'handoff.action must be HANDOFF_TO_FRIENDSHIP');
}

/**
 * startPhase3ProbeFromConversationHandoff({ handoff, session_id, peer_actor_id })
 *
 * Produces a minimal Phase3 probe-init message using the existing Phase3 probe mechanism.
 * This does NOT send anything; it only prepares the probe input.
 */
export function startPhase3ProbeFromConversationHandoff({ handoff, session_id, peer_actor_id } = {}) {
  assertHandoff(handoff);
  assertNonEmptyString(session_id, 'session_id');
  assertNonEmptyString(peer_actor_id, 'peer_actor_id');

  const phase3_probe_message = {
    kind: 'SESSION_PROBE_INIT',
    session_id,
    peer_actor_id
  };

  return {
    ok: true,
    response: {
      conversation_handoff: {
        handoff_id: handoff.handoff_id,
        surface_id: handoff.surface_id,
        action: handoff.action,
        proceed: handoff.proceed,
        target: handoff.target
      },
      phase3_probe_started: true,
      phase3_probe_message
    },
    error: null
  };
}
