// Phase 3 (Session / Probe Runtime) — minimal session state transition baseline.
// This module is intentionally small and isolated:
// - No transport changes
// - No envelope/protocol changes
// - No inbound wiring
// - No capability invocation
// - No mailbox / retry
// - No friendship persistence

import { SESSION_PROBE_KINDS_PHASE3_LIST, SESSION_PROBE_KINDS_PHASE3 } from './sessionProbeKinds.mjs';

export const SESSION_STATES_PHASE3 = Object.freeze({
  NEW: 'NEW',
  LOCAL_ENTERED: 'LOCAL_ENTERED',
  REMOTE_ENTERED: 'REMOTE_ENTERED',
  PROBING: 'PROBING'
});

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function assertNonEmptyString(v, name) {
  if (typeof v !== 'string' || v.trim() === '') throw err('INVALID_INPUT', `missing ${name}`);
}

function normalizeState(input) {
  if (!input || typeof input !== 'object') throw err('INVALID_STATE', 'state must be object');

  const session_id = input.session_id ?? null;
  const peer_actor_id = input.peer_actor_id ?? null;
  const st = input.state ?? SESSION_STATES_PHASE3.NEW;

  const local_entered = Boolean(input.local_entered);
  const remote_entered = Boolean(input.remote_entered);

  if (st && !Object.values(SESSION_STATES_PHASE3).includes(st)) throw err('INVALID_STATE', 'unknown session state');

  // Return a machine-safe, deterministic shape (fixed keys).
  return {
    session_id,
    peer_actor_id,
    state: st,
    local_entered,
    remote_entered
  };
}

function normalizeMessage(input) {
  if (!input || typeof input !== 'object') throw err('INVALID_MESSAGE', 'message must be object');
  const kind = input.kind;
  if (typeof kind !== 'string' || kind.trim() === '') throw err('INVALID_MESSAGE', 'missing kind');
  if (!SESSION_PROBE_KINDS_PHASE3_LIST.includes(kind)) throw err('UNKNOWN_KIND', 'unknown message kind');

  const session_id = input.session_id;
  const peer_actor_id = input.peer_actor_id;
  assertNonEmptyString(session_id, 'session_id');
  assertNonEmptyString(peer_actor_id, 'peer_actor_id');

  return { kind, session_id, peer_actor_id };
}

function nextStateWithPatch(prev, patch) {
  // Construct new object with deterministic key order.
  const next = {
    session_id: patch.session_id ?? prev.session_id,
    peer_actor_id: patch.peer_actor_id ?? prev.peer_actor_id,
    state: patch.state ?? prev.state,
    local_entered: patch.local_entered ?? prev.local_entered,
    remote_entered: patch.remote_entered ?? prev.remote_entered
  };

  // Deterministic output: always the same keys.
  return next;
}

/**
 * applySessionProbeMessage({ state, message })
 *
 * Minimal Phase 3 transition function.
 * - Fail closed on unknown kind, missing fields, or illegal state/message combination.
 * - Returns a minimal machine-safe session state.
 */
export function applySessionProbeMessage({ state, message }) {
  const st = normalizeState(state);
  const msg = normalizeMessage(message);

  // State/message consistency.
  if (st.session_id && st.session_id !== msg.session_id) throw err('MISMATCH', 'session_id mismatch');
  if (st.peer_actor_id && st.peer_actor_id !== msg.peer_actor_id) throw err('MISMATCH', 'peer_actor_id mismatch');

  if (msg.kind === SESSION_PROBE_KINDS_PHASE3.SESSION_PROBE_INIT) {
    if (st.state !== SESSION_STATES_PHASE3.NEW) throw err('ILLEGAL_TRANSITION', 'illegal init transition');
    if (st.local_entered || st.remote_entered) throw err('ILLEGAL_TRANSITION', 'init requires clean NEW state');

    return nextStateWithPatch(st, {
      session_id: msg.session_id,
      peer_actor_id: msg.peer_actor_id,
      state: SESSION_STATES_PHASE3.LOCAL_ENTERED,
      local_entered: true,
      remote_entered: false
    });
  }

  if (msg.kind === SESSION_PROBE_KINDS_PHASE3.SESSION_PROBE_ACK) {
    // Minimal baseline: ACK is only valid after INIT.
    if (st.state !== SESSION_STATES_PHASE3.LOCAL_ENTERED) throw err('ILLEGAL_TRANSITION', 'illegal ack transition');
    if (!st.local_entered) throw err('ILLEGAL_TRANSITION', 'ack requires local_entered=true');
    if (st.remote_entered) throw err('ILLEGAL_TRANSITION', 'ack must not repeat');

    return nextStateWithPatch(st, {
      session_id: msg.session_id,
      peer_actor_id: msg.peer_actor_id,
      state: SESSION_STATES_PHASE3.PROBING,
      local_entered: true,
      remote_entered: true
    });
  }

  // Defensive: should be unreachable because normalizeMessage gates kind.
  throw err('UNKNOWN_KIND', 'unknown message kind');
}
