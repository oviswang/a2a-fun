function isNonEmptyString(x) {
  return typeof x === 'string' && x.trim() !== '';
}

function isStringArray(x) {
  return Array.isArray(x) && x.every((v) => typeof v === 'string');
}

function fail(code) {
  return { ok: false, message: null, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export function createAgentHandshakeMessage({ from_agent_id, to_agent_id, name = '', mission = '', skills = [], timestamp } = {}) {
  if (!isNonEmptyString(from_agent_id)) return fail('INVALID_FROM_AGENT_ID');
  if (!isNonEmptyString(to_agent_id)) return fail('INVALID_TO_AGENT_ID');
  if (name != null && typeof name !== 'string') return fail('INVALID_NAME');
  if (mission != null && typeof mission !== 'string') return fail('INVALID_MISSION');
  if (skills != null && !isStringArray(skills)) return fail('INVALID_SKILLS');
  if (!isNonEmptyString(timestamp)) return fail('INVALID_TIMESTAMP');

  const sk = (skills || []).map((s) => s.trim()).filter(Boolean).slice(0, 50);

  return {
    ok: true,
    message: {
      kind: 'AGENT_HANDSHAKE',
      from_agent_id: from_agent_id.trim(),
      to_agent_id: to_agent_id.trim(),
      name: String(name || '').trim().slice(0, 80),
      mission: String(mission || '').trim().slice(0, 160),
      skills: sk.sort((a, b) => a.localeCompare(b)),
      timestamp: timestamp.trim()
    },
    error: null
  };
}

export function isAgentHandshakeMessage(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  if (x.kind !== 'AGENT_HANDSHAKE') return false;
  if (!isNonEmptyString(x.from_agent_id)) return false;
  if (!isNonEmptyString(x.to_agent_id)) return false;
  if (typeof x.name !== 'string') return false;
  if (typeof x.mission !== 'string') return false;
  if (!isStringArray(x.skills)) return false;
  if (!isNonEmptyString(x.timestamp)) return false;
  return true;
}
