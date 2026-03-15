function isNonEmptyString(x) {
  return typeof x === 'string' && x.trim() !== '';
}

function isStringArray(x) {
  return Array.isArray(x) && x.every((v) => typeof v === 'string');
}

function fail(code) {
  return { ok: false, message: null, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export function createAgentProfileExchangeMessage({
  dialogue_id,
  turn,
  from_agent_id,
  to_agent_id,
  name = '',
  mission = '',
  summary = '',
  skills = [],
  current_focus = '',
  prompt = '',
  message = '',
  timestamp
} = {}) {
  if (!isNonEmptyString(dialogue_id)) return fail('INVALID_DIALOGUE_ID');
  if (!Number.isInteger(turn) || turn < 1 || turn > 4) return fail('INVALID_TURN');
  if (!isNonEmptyString(from_agent_id)) return fail('INVALID_FROM_AGENT_ID');
  if (!isNonEmptyString(to_agent_id)) return fail('INVALID_TO_AGENT_ID');
  if (skills != null && !isStringArray(skills)) return fail('INVALID_SKILLS');
  if (!isNonEmptyString(timestamp)) return fail('INVALID_TIMESTAMP');

  const sk = (skills || []).map((s) => s.trim()).filter(Boolean).slice(0, 50).sort((a, b) => a.localeCompare(b));

  return {
    ok: true,
    message: {
      kind: 'AGENT_PROFILE_EXCHANGE',
      dialogue_id: dialogue_id.trim(),
      turn,
      from_agent_id: from_agent_id.trim(),
      to_agent_id: to_agent_id.trim(),
      name: String(name || '').trim().slice(0, 80),
      mission: String(mission || '').trim().slice(0, 160),
      summary: String(summary || '').trim().slice(0, 280),
      skills: sk,
      current_focus: String(current_focus || '').trim().slice(0, 160),
      prompt: String(prompt || '').trim().slice(0, 280),
      message: String(message || '').trim().slice(0, 1200),
      timestamp: timestamp.trim()
    },
    error: null
  };
}

export function isAgentProfileExchangeMessage(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  if (x.kind !== 'AGENT_PROFILE_EXCHANGE') return false;
  if (!isNonEmptyString(x.dialogue_id)) return false;
  if (!Number.isInteger(x.turn)) return false;
  if (!isNonEmptyString(x.from_agent_id)) return false;
  if (!isNonEmptyString(x.to_agent_id)) return false;
  if (typeof x.name !== 'string') return false;
  if (typeof x.mission !== 'string') return false;
  if (typeof x.summary !== 'string') return false;
  if (!isStringArray(x.skills)) return false;
  if (typeof x.current_focus !== 'string') return false;
  if (typeof x.prompt !== 'string') return false;
  if (!isNonEmptyString(x.message)) return false;
  if (!isNonEmptyString(x.timestamp)) return false;
  return true;
}
