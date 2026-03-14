import { isAgentCard } from './agentCard.mjs';
import { rankCandidatesByTrust } from '../social/trustRecommendationRuntime.mjs';

function fail(code) {
  return { ok: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

function norm(s) {
  return String(s || '').toLowerCase();
}

function matches(card, q) {
  const needle = norm(q);
  if (!needle) return true;
  const hay = [
    card.name,
    card.mission,
    card.summary,
    ...(card.skills || []),
    ...(card.tags || [])
  ]
    .map(norm)
    .join('\n');
  return hay.includes(needle);
}

export function searchAgents({ agent_cards, query, trust_edges = null, local_agent_id = null } = {}) {
  if (!Array.isArray(agent_cards)) return fail('INVALID_AGENT_CARDS');
  if (typeof query !== 'string') return fail('INVALID_QUERY');

  for (const c of agent_cards) {
    if (!isAgentCard(c)) return fail('INVALID_AGENT_CARD');
  }

  const filtered = agent_cards.filter((c) => matches(c, query));

  // default ordering: agent_id asc
  let ordered = [...filtered].sort((a, b) => String(a.agent_id).localeCompare(String(b.agent_id)));

  // Trust-aware reordering (best-effort, optional).
  if (Array.isArray(trust_edges) && typeof local_agent_id === 'string' && local_agent_id.trim()) {
    const candidates = ordered.map((c) => c.agent_id);
    const rec = rankCandidatesByTrust({ trust_edges, local_agent_id, candidates });
    if (rec && rec.ok === true) {
      const idx = new Map(rec.recommendations.map((r, i) => [r.agent_id, i]));
      ordered.sort((a, b) => (idx.get(a.agent_id) ?? 1e9) - (idx.get(b.agent_id) ?? 1e9));
    }
  }

  return { ok: true, results: ordered };
}
