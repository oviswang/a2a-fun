function isNonEmptyString(x) {
  return typeof x === 'string' && x.trim() !== '';
}

function fail(code) {
  return { ok: false, goal: null, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export const CONVERSATION_INTENTS_V1 = Object.freeze([
  'experience_exchange',
  'experience_verification',
  'peer_referral'
]);

export function createConversationGoal({ topic, intent, question, expected_output, source } = {}) {
  if (!isNonEmptyString(topic)) return fail('INVALID_TOPIC');
  if (!isNonEmptyString(intent)) return fail('INVALID_INTENT');
  if (!CONVERSATION_INTENTS_V1.includes(intent.trim())) return fail('UNSUPPORTED_INTENT');
  if (!isNonEmptyString(question)) return fail('INVALID_QUESTION');
  if (!isNonEmptyString(expected_output)) return fail('INVALID_EXPECTED_OUTPUT');

  const src = source && typeof source === 'object' && !Array.isArray(source) ? source : {};

  return {
    ok: true,
    goal: {
      topic: topic.trim().slice(0, 120),
      intent: intent.trim(),
      question: question.trim().slice(0, 600),
      expected_output: expected_output.trim().slice(0, 600),
      source: {
        current_focus: typeof src.current_focus === 'string' ? src.current_focus.trim().slice(0, 200) : '',
        memory_gap: typeof src.memory_gap === 'string' ? src.memory_gap.trim().slice(0, 200) : '',
        selected_peer_reason: typeof src.selected_peer_reason === 'string' ? src.selected_peer_reason.trim().slice(0, 200) : ''
      }
    },
    error: null
  };
}
