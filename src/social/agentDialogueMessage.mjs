function isNonEmptyString(x) {
  return typeof x === 'string' && x.trim() !== '';
}

function fail(code) {
  return { ok: false, message: null, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export function createAgentDialogueMessage({
  dialogue_id,
  turn,
  from_agent_id,
  to_agent_id,
  topic,
  message,
  created_at
} = {}) {
  if (!isNonEmptyString(dialogue_id)) return fail('INVALID_DIALOGUE_ID');
  if (!Number.isInteger(turn) || turn < 1 || turn > 99) return fail('INVALID_TURN');
  if (!isNonEmptyString(from_agent_id)) return fail('INVALID_FROM_AGENT_ID');
  if (!isNonEmptyString(to_agent_id)) return fail('INVALID_TO_AGENT_ID');
  if (!isNonEmptyString(topic)) return fail('INVALID_TOPIC');
  if (!isNonEmptyString(message)) return fail('INVALID_MESSAGE');
  if (!isNonEmptyString(created_at)) return fail('INVALID_CREATED_AT');

  return {
    ok: true,
    message: {
      kind: 'AGENT_DIALOGUE',
      dialogue_id: dialogue_id.trim(),
      turn,
      from_agent_id: from_agent_id.trim(),
      to_agent_id: to_agent_id.trim(),
      topic: topic.trim().slice(0, 120),
      message: message.trim().slice(0, 1200),
      created_at: created_at.trim()
    },
    error: null
  };
}

export function isAgentDialogueMessage(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  if (x.kind !== 'AGENT_DIALOGUE') return false;
  if (!isNonEmptyString(x.dialogue_id)) return false;
  if (!Number.isInteger(x.turn)) return false;
  if (!isNonEmptyString(x.from_agent_id)) return false;
  if (!isNonEmptyString(x.to_agent_id)) return false;
  if (!isNonEmptyString(x.topic)) return false;
  if (!isNonEmptyString(x.message)) return false;
  if (!isNonEmptyString(x.created_at)) return false;
  return true;
}
