// PHASE 2 FROZEN
// Behavior must remain stable unless fixing a critical bug.

import { computeEventHash } from './audit.hashing.mjs';

/**
 * Bind inbound processing into an audit log record.
 * preview_safe MUST be metadata-only (no text).
 */
export function bindInboundAudit({ envelope, stage, extra = {} }) {
  if (!envelope) throw new Error('AuditBinder: missing envelope');
  const event_core = {
    kind: 'INBOUND',
    stage,
    session_id: envelope.session_id,
    msg_id: envelope.msg_id,
    type: envelope.type,
    ts: envelope.ts,
    ...extra
  };
  return {
    session_id: envelope.session_id,
    ts: new Date().toISOString(),
    event_type: 'MSG_RECV',
    event_hash: computeEventHash(event_core),
    preview_safe: {
      type: envelope.type,
      stage,
      msg_id: envelope.msg_id,
      session_id: envelope.session_id
    }
  };
}

/**
 * Bind a SessionManager audit_event core into an audit record.
 * Minimal rule: 1 inbound processing => bind each audit_events[] element 1:1.
 * preview_safe MUST be metadata-only (no text).
 */
export function bindAuditEventCore({ event_core, envelope }) {
  if (!event_core) throw new Error('AuditBinder: missing event_core');
  if (!envelope) throw new Error('AuditBinder: missing envelope');

  // event_core is already text-free by construction (Phase 2 contract).
  const event_hash = computeEventHash(event_core);

  return {
    session_id: event_core.session_id ?? envelope.session_id,
    ts: new Date().toISOString(),
    event_type: 'SESSION_EVENT',
    event_hash,
    preview_safe: {
      kind: event_core.kind,
      type: event_core.type,
      prev_state: event_core.prev_state,
      next_state: event_core.next_state,
      flags_delta: event_core.flags_delta,
      msg_id: event_core.msg_id,
      session_id: event_core.session_id
    }
  };
}
