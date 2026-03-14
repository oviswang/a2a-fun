function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function nonEmptyString(x) {
  return typeof x === 'string' && x.trim() !== '';
}

export function createRemoteHumanJoinSignal({ handoff_id, from_agent_id, to_agent_id, created_at } = {}) {
  if (!nonEmptyString(handoff_id)) return { ok: false, error: { code: 'INVALID_HANDOFF_ID' } };
  if (!nonEmptyString(from_agent_id)) return { ok: false, error: { code: 'INVALID_FROM_AGENT_ID' } };
  if (!nonEmptyString(to_agent_id)) return { ok: false, error: { code: 'INVALID_TO_AGENT_ID' } };
  if (!nonEmptyString(created_at)) return { ok: false, error: { code: 'INVALID_CREATED_AT' } };

  return {
    ok: true,
    signal: {
      kind: 'REMOTE_HUMAN_JOIN_SIGNAL',
      handoff_id: handoff_id.trim(),
      from_agent_id: from_agent_id.trim(),
      to_agent_id: to_agent_id.trim(),
      created_at: created_at.trim()
    }
  };
}

export function validateRemoteHumanJoinSignal(signal) {
  if (!isObj(signal)) return { ok: false, error: { code: 'INVALID_SIGNAL' } };
  if (signal.kind !== 'REMOTE_HUMAN_JOIN_SIGNAL') return { ok: false, error: { code: 'INVALID_KIND' } };
  if (!nonEmptyString(signal.handoff_id)) return { ok: false, error: { code: 'INVALID_HANDOFF_ID' } };
  if (!nonEmptyString(signal.from_agent_id)) return { ok: false, error: { code: 'INVALID_FROM_AGENT_ID' } };
  if (!nonEmptyString(signal.to_agent_id)) return { ok: false, error: { code: 'INVALID_TO_AGENT_ID' } };
  if (!nonEmptyString(signal.created_at)) return { ok: false, error: { code: 'INVALID_CREATED_AT' } };
  return { ok: true };
}
