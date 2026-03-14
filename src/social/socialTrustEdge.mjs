function isNonEmptyString(x) {
  return typeof x === 'string' && x.trim() !== '';
}

export function createTrustEdge({ local_agent_id, remote_agent_id, established_at } = {}) {
  if (!isNonEmptyString(local_agent_id)) return { ok: false, error: { code: 'INVALID_LOCAL_AGENT_ID' } };
  if (!isNonEmptyString(remote_agent_id)) return { ok: false, error: { code: 'INVALID_REMOTE_AGENT_ID' } };
  if (!isNonEmptyString(established_at)) return { ok: false, error: { code: 'INVALID_ESTABLISHED_AT' } };

  return {
    ok: true,
    local_agent_id: local_agent_id.trim(),
    remote_agent_id: remote_agent_id.trim(),
    established_at: established_at.trim(),
    trust_level: 1
  };
}
