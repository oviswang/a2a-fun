function isNonEmptyString(x) {
  return typeof x === 'string' && x.trim() !== '';
}

function fail(code) {
  return { ok: false, message: null, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export function createOpenClawLiveQueryRequest({ request_id, from_agent_id, to_agent_id, question_type, question_text, created_at } = {}) {
  if (!isNonEmptyString(request_id)) return fail('INVALID_REQUEST_ID');
  if (!isNonEmptyString(from_agent_id)) return fail('INVALID_FROM');
  if (!isNonEmptyString(to_agent_id)) return fail('INVALID_TO');
  if (!isNonEmptyString(question_type)) return fail('INVALID_TYPE');
  if (!isNonEmptyString(question_text)) return fail('INVALID_TEXT');
  if (!isNonEmptyString(created_at)) return fail('INVALID_CREATED_AT');

  return {
    ok: true,
    message: {
      kind: 'OPENCLAW_LIVE_QUERY_REQUEST',
      request_id: request_id.trim(),
      from_agent_id: from_agent_id.trim(),
      to_agent_id: to_agent_id.trim(),
      question_type: question_type.trim(),
      question_text: question_text.trim().slice(0, 240),
      created_at: created_at.trim()
    },
    error: null
  };
}

export function createOpenClawLiveQueryReply({ request_id, from_agent_id, to_agent_id, ok, answer_text, error, created_at } = {}) {
  if (!isNonEmptyString(request_id)) return fail('INVALID_REQUEST_ID');
  if (!isNonEmptyString(from_agent_id)) return fail('INVALID_FROM');
  if (!isNonEmptyString(to_agent_id)) return fail('INVALID_TO');
  if (!isNonEmptyString(created_at)) return fail('INVALID_CREATED_AT');

  return {
    ok: true,
    message: {
      kind: 'OPENCLAW_LIVE_QUERY_REPLY',
      request_id: request_id.trim(),
      from_agent_id: from_agent_id.trim(),
      to_agent_id: to_agent_id.trim(),
      ok: ok === true,
      answer_text: typeof answer_text === 'string' ? answer_text.trim().slice(0, 1200) : null,
      error: error || null,
      created_at: created_at.trim()
    },
    error: null
  };
}
