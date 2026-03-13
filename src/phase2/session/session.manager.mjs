// PHASE 2 FROZEN
// Behavior must remain stable unless fixing a critical bug.

import { makeEmptySessionApplyResult } from './session.types.mjs';
import {
  SUPPORTED_MESSAGE_TYPES_PHASE2,
  ALLOWED_TRANSITIONS_PHASE2,
  CLOSE_REASONS_PHASE2,
  LOCAL_EVENT_TYPES_PHASE2,
  ALLOWED_LOCAL_EVENTS_PHASE2
} from '../config/phase2.constants.mjs';

const STATES = [
  'DISCONNECTED',
  'PROBING',
  'PROBE_COMPLETE',
  'AWAIT_ENTRY',
  'MUTUAL_ENTRY_CONFIRMED',
  'CLOSED',
  'FAILED'
];

const TERMINAL = new Set(['CLOSED', 'FAILED']);

// Machine-safe allowlist for session.close reasons lives in phase2.constants.mjs

function assertState(s) {
  if (!s || typeof s !== 'object') throw new Error('SessionManager: missing state');
  if (!STATES.includes(s.state)) throw new Error(`SessionManager: unknown/invalid state: ${s.state}`);
  if (typeof s.session_id !== 'string' || !s.session_id) throw new Error('SessionManager: missing session_id');
  if (typeof s.peer_actor_id !== 'string' || !s.peer_actor_id) throw new Error('SessionManager: missing peer_actor_id');
  if (typeof s.local_entered !== 'boolean') throw new Error('SessionManager: missing local_entered');
  if (typeof s.remote_entered !== 'boolean') throw new Error('SessionManager: missing remote_entered');
}

function assertSupportedType(t) {
  if (!SUPPORTED_MESSAGE_TYPES_PHASE2.includes(t)) {
    throw new Error(`SessionManager: unsupported message type in Phase 2: ${t}`);
  }
}

function flagsDelta(prev, next) {
  const d = {};
  if (prev.local_entered !== next.local_entered) d.local_entered = next.local_entered;
  if (prev.remote_entered !== next.remote_entered) d.remote_entered = next.remote_entered;
  return d;
}

function makeAuditCore({ kind, session_id, msg_id, type, prev_state, next_state, flags_delta }) {
  return { kind, session_id, msg_id, type, prev_state, next_state, flags_delta };
}

/**
 * Phase 2 minimal SessionManager apply.
 *
 * Inputs are assumed to have passed:
 * - envelope schema validate
 * - signature verify
 * - decrypted body schema validate
 *
 * Fail closed: throw on any illegal transition.
 */
export function applySessionMessage({ state, verifiedEnvelope, decryptedBody }) {
  assertState(state);
  if (!verifiedEnvelope) throw new Error('SessionManager: missing verifiedEnvelope');
  if (!decryptedBody) throw new Error('SessionManager: missing decryptedBody');

  const type = verifiedEnvelope.type;
  assertSupportedType(type);

  if (TERMINAL.has(state.state)) {
    throw new Error(`SessionManager: unsupported transition from terminal state: ${state.state}`);
  }

  // Allowlist gate (source of truth): fail closed for any disallowed (state, type).
  const allowed = ALLOWED_TRANSITIONS_PHASE2[state.state] ?? null;
  if (!allowed || !allowed.includes(type)) {
    throw new Error(`SessionManager: illegal transition (${state.state} + ${type})`);
  }

  const prev_state = state.state;
  let next = { ...state };
  let patch = {};

  // Transition rules
  if (type === 'probe.hello') {
    if (state.state !== 'DISCONNECTED') throw new Error('SessionManager: illegal transition (probe.hello)');
    next.state = 'PROBING';
    patch = { state: next.state };
  } else if (type === 'probe.question' || type === 'probe.answer') {
    if (state.state !== 'PROBING') throw new Error(`SessionManager: illegal transition (${type})`);
    // Phase 2: do not implement probe engine; keep state. (probe_rounds_used can be added later.)
    next.state = 'PROBING';
    patch = { state: next.state };
  } else if (type === 'probe.summary' || type === 'probe.done') {
    if (state.state !== 'PROBING') throw new Error(`SessionManager: illegal transition (${type})`);
    next.state = 'PROBE_COMPLETE';
    patch = { state: next.state };
  } else if (type === 'human.entry') {
    if (!(state.state === 'PROBE_COMPLETE' || state.state === 'AWAIT_ENTRY')) {
      throw new Error('SessionManager: illegal transition (human.entry)');
    }

    // Idempotent behavior under AWAIT_ENTRY:
    // - if remote_entered already true, do not change flags, do not error.
    const remoteWas = state.remote_entered;
    next.remote_entered = true;

    if (next.local_entered && next.remote_entered) {
      next.state = 'MUTUAL_ENTRY_CONFIRMED';
    } else {
      next.state = 'AWAIT_ENTRY';
    }

    // patch only changed fields
    patch = { state: next.state };
    if (!remoteWas) patch.remote_entered = true;
  } else if (type === 'session.close') {
    // close from any non-terminal state
    const reason = decryptedBody.reason;
    if (!CLOSE_REASONS_PHASE2.includes(reason)) {
      throw new Error('SessionManager: session.close.closed_reason invalid');
    }
    next.state = 'CLOSED';
    next.closed_reason = reason;
    patch = { state: next.state, closed_reason: reason };
  } else if (type === 'error') {
    // Phase 2: state unchanged; audit only.
    patch = {};
  } else {
    // Other supported types are not yet part of Phase 2 state transitions.
    throw new Error(`SessionManager: unsupported transition for type: ${type}`);
  }

  const res = makeEmptySessionApplyResult(next, patch);
  const fd = flagsDelta(state, next);
  res.audit_events.push(
    makeAuditCore({
      kind: type === 'error' ? 'SESSION_ERROR' : 'SESSION_TRANSITION',
      session_id: state.session_id,
      msg_id: verifiedEnvelope.msg_id,
      type,
      prev_state,
      next_state: next.state,
      flags_delta: fd
    })
  );

  return res;
}

function assertLocalEvent(localEvent) {
  if (!localEvent || typeof localEvent !== 'object') throw new Error('SessionManager: missing localEvent');
  if (typeof localEvent.type !== 'string' || !localEvent.type) throw new Error('SessionManager: localEvent.type required');
  if (!LOCAL_EVENT_TYPES_PHASE2.includes(localEvent.type)) {
    throw new Error(`SessionManager: unsupported local event type in Phase 2: ${localEvent.type}`);
  }
  if (typeof localEvent.event_id !== 'string' || !localEvent.event_id) {
    throw new Error('SessionManager: localEvent.event_id required');
  }
}

/**
 * Phase 2 local event injection.
 *
 * Hard rules (per spec in chat):
 * - Only local.human.entry and local.session.close
 * - local.human.entry only allowed in PROBE_COMPLETE or AWAIT_ENTRY
 * - local.human.entry is idempotent if local_entered already true (no repeated flags_delta, no error)
 * - local.session.close allowed in any non-terminal state, reason must be in CLOSE_REASONS_PHASE2
 * - local events must enforce allowlist gate + terminal rule + minimal audit_event core fields
 */
export function applyLocalEvent({ state, localEvent }) {
  assertState(state);
  assertLocalEvent(localEvent);

  if (TERMINAL.has(state.state)) {
    throw new Error(`SessionManager: unsupported local event from terminal state: ${state.state}`);
  }

  const allowed = ALLOWED_LOCAL_EVENTS_PHASE2[state.state] ?? null;
  if (!allowed || !allowed.includes(localEvent.type)) {
    throw new Error(`SessionManager: illegal local event (${state.state} + ${localEvent.type})`);
  }

  const prev_state = state.state;
  let next = { ...state };
  let patch = {};

  if (localEvent.type === 'local.human.entry') {
    // Only PROBE_COMPLETE / AWAIT_ENTRY are allowed by allowlist.
    const was = state.local_entered;
    next.local_entered = true;

    // Update state based on mutual entry.
    if (next.local_entered && next.remote_entered) {
      next.state = 'MUTUAL_ENTRY_CONFIRMED';
    } else {
      next.state = 'AWAIT_ENTRY';
    }

    patch = { state: next.state };
    if (!was) patch.local_entered = true;
  } else if (localEvent.type === 'local.session.close') {
    const reason = localEvent.reason;
    if (!CLOSE_REASONS_PHASE2.includes(reason)) {
      throw new Error('SessionManager: local.session.close.reason invalid');
    }
    next.state = 'CLOSED';
    next.closed_reason = reason;
    patch = { state: next.state, closed_reason: reason };
  } else {
    throw new Error(`SessionManager: local event not implemented: ${localEvent.type}`);
  }

  const res = makeEmptySessionApplyResult(next, patch);
  const fd = flagsDelta(state, next);
  res.audit_events.push(
    makeAuditCore({
      kind: 'LOCAL_EVENT',
      session_id: state.session_id,
      msg_id: `local:${localEvent.event_id}`,
      type: localEvent.type,
      prev_state,
      next_state: next.state,
      flags_delta: fd
    })
  );
  return res;
}
