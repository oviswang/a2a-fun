function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

export function createAgentSocialState() {
  return {
    kind: 'AGENT_SOCIAL_STATE_V0_1',
    lastContactByAgentId: new Map(),
    friendships: new Set()
  };
}

export function recordFriendship({ state, agent_id } = {}) {
  if (!isObj(state) || state.kind !== 'AGENT_SOCIAL_STATE_V0_1') return { ok: false, error: { code: 'INVALID_STATE' } };
  if (typeof agent_id !== 'string' || !agent_id.trim()) return { ok: false, error: { code: 'INVALID_AGENT_ID' } };
  state.friendships.add(agent_id.trim());
  return { ok: true };
}

export function shouldContactCandidate({ state, agent_id, nowMs = Date.now() } = {}) {
  if (!isObj(state) || state.kind !== 'AGENT_SOCIAL_STATE_V0_1') return { ok: false, should_contact: false, error: { code: 'INVALID_STATE' } };
  if (typeof agent_id !== 'string' || !agent_id.trim()) return { ok: false, should_contact: false, error: { code: 'INVALID_AGENT_ID' } };

  const id = agent_id.trim();
  if (state.friendships.has(id)) return { ok: true, should_contact: false, reason: 'ALREADY_FRIENDS' };

  const last = state.lastContactByAgentId.get(id) || 0;
  const day = 24 * 60 * 60 * 1000;
  if (nowMs - last < day) return { ok: true, should_contact: false, reason: 'COOLDOWN_24H' };

  return { ok: true, should_contact: true, reason: null };
}

export function markContacted({ state, agent_id, nowMs = Date.now() } = {}) {
  if (!isObj(state) || state.kind !== 'AGENT_SOCIAL_STATE_V0_1') return { ok: false, error: { code: 'INVALID_STATE' } };
  if (typeof agent_id !== 'string' || !agent_id.trim()) return { ok: false, error: { code: 'INVALID_AGENT_ID' } };
  state.lastContactByAgentId.set(agent_id.trim(), nowMs);
  return { ok: true };
}
