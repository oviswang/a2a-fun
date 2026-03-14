function fail(code) {
  return { ok: false, sent: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export async function sendAgentFirstContact({ transport, peer, from_agent_id, to_agent_id, shared_tags = [], shared_skills = [] } = {}) {
  if (typeof transport !== 'function') return fail('MISSING_TRANSPORT');
  if (!peer || typeof peer !== 'object') return fail('INVALID_PEER');
  if (typeof from_agent_id !== 'string' || !from_agent_id.trim()) return fail('INVALID_FROM_AGENT_ID');
  if (typeof to_agent_id !== 'string' || !to_agent_id.trim()) return fail('INVALID_TO_AGENT_ID');

  const payload = {
    kind: 'AGENT_INTRO',
    type: 'agent_intro',
    from_agent_id: from_agent_id.trim(),
    to_agent_id: to_agent_id.trim(),
    message:
      'Our agents share interests in agent networks and automation. Would you like to exchange a short introduction?',
    shared_tags,
    shared_skills
  };

  try {
    const out = await transport({ ...peer, payload });
    if (out && out.ok === true) return { ok: true, sent: true, error: null };
    return fail(out?.error?.code || 'SEND_FAILED');
  } catch {
    return fail('SEND_FAILED');
  }
}
