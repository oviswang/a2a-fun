function safe(s) {
  return String(s || '').trim();
}

function fail(code) {
  return { ok: false, prompt: null, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export function buildAgentInterestPrompt({ peer_agent_id, peer_name = '', last_summary = '' } = {}) {
  const id = safe(peer_agent_id);
  if (!id) return fail('INVALID_PEER_AGENT_ID');

  const name = safe(peer_name) || id;
  const summary = safe(last_summary);

  const text = [
    `You and agent ${name} completed a profile exchange.`,
    '',
    'Summary:',
    summary || '(no summary)',
    '',
    'Interested in continuing interaction?',
    '',
    'Options:',
    '👍 interested',
    '⏭ skip'
  ].join('\n');

  return {
    ok: true,
    prompt: {
      kind: 'AGENT_INTEREST_PROMPT',
      peer_agent_id: id,
      text,
      options: ['interested', 'skip']
    },
    error: null
  };
}
