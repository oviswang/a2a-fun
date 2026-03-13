// PHASE 2 FROZEN
// Behavior must remain stable unless fixing a critical bug.

/**
 * Phase 2 constants.
 * Keep Phase 2 allowlists and hard-coded scope constraints here.
 */

export const SUPPORTED_MESSAGE_TYPES_PHASE2 = [
  'probe.hello',
  'probe.question',
  'probe.answer',
  'probe.summary',
  'probe.done',
  'human.entry',
  'human.exit',
  'friendship.establish',
  'session.close',
  'error'
];

export const RESERVED_MESSAGE_TYPES_PHASE2 = [
  // v0.4.4 exchange framework related behavior is reserved (fields only).
  'exchange.request',
  'exchange.response'
];

export const SUPPORTED_PROTOCOLS_PHASE2 = [
  'a2a.friendship/1'
];

export const SUPPORTED_TRANSPORTS_PHASE2 = [
  'webrtc',
  'tcp'
];

// Phase 2 SessionManager allowlist (source of truth)
export const CLOSE_REASONS_PHASE2 = [
  'NO_HUMAN_ENTRY_TIMEOUT',
  'PROBE_TIMEOUT',
  'USER_CLOSE',
  'POLICY_REJECT',
  'TRANSPORT_FAIL',
  'PROTOCOL_VIOLATION'
];

export const LOCAL_EVENT_TYPES_PHASE2 = [
  'local.human.entry',
  'local.session.close'
];

export const ALLOWED_LOCAL_EVENTS_PHASE2 = {
  DISCONNECTED: [],
  PROBING: ['local.session.close'],
  PROBE_COMPLETE: ['local.human.entry', 'local.session.close'],
  AWAIT_ENTRY: ['local.human.entry', 'local.session.close'],
  MUTUAL_ENTRY_CONFIRMED: ['local.session.close'],
  CLOSED: [],
  FAILED: []
};

export const ALLOWED_TRANSITIONS_PHASE2 = {
  DISCONNECTED: ['probe.hello', 'session.close', 'error'],
  PROBING: ['probe.question', 'probe.answer', 'probe.summary', 'probe.done', 'session.close', 'error'],
  PROBE_COMPLETE: ['human.entry', 'session.close', 'error'],
  AWAIT_ENTRY: ['human.entry', 'session.close', 'error'],
  MUTUAL_ENTRY_CONFIRMED: ['session.close', 'error'],
  CLOSED: [],
  FAILED: []
};
