// PHASE 2 FROZEN
// Behavior must remain stable unless fixing a critical bug.

/**
 * Phase 2 Session types.
 */

/**
 * SessionApplyResult (normative skeleton)
 * - next_state: full next SessionState
 * - session_patch: minimal patch suitable for storage.updateSession
 * - audit_events: array of audit event cores (text-free)
 * - outbound_messages: array (kept minimal in Phase 2)
 */

export function makeEmptySessionApplyResult(next_state, session_patch = {}) {
  return {
    next_state,
    session_patch,
    audit_events: [],
    outbound_messages: []
  };
}
