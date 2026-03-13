// Phase 3 (Session / Probe Runtime) — minimal message-kind subset.
// Documentation: PHASE3_SESSION_PROBE_PLAN.md
// Hard constraints: does NOT modify frozen envelope semantics; pure constants.

export const SESSION_PROBE_KINDS_PHASE3 = Object.freeze({
  SESSION_PROBE_INIT: 'SESSION_PROBE_INIT',
  SESSION_PROBE_ACK: 'SESSION_PROBE_ACK'
});

export const SESSION_PROBE_KINDS_PHASE3_LIST = Object.freeze(
  Object.freeze(Object.values(SESSION_PROBE_KINDS_PHASE3))
);
