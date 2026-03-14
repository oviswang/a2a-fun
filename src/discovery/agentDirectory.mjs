import { isAgentCard } from './agentCard.mjs';

function fail(code) {
  return { ok: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export function listAgents({ agent_cards } = {}) {
  if (!Array.isArray(agent_cards)) return fail('INVALID_AGENT_CARDS');
  for (const c of agent_cards) {
    if (!isAgentCard(c)) return fail('INVALID_AGENT_CARD');
  }

  const agents = [...agent_cards].sort((a, b) => String(a.agent_id).localeCompare(String(b.agent_id)));
  return { ok: true, agents };
}
