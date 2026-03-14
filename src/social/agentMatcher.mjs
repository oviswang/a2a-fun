import { computeTrustScore } from './trustScore.mjs';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function arr(x) {
  return Array.isArray(x) ? x.filter((s) => typeof s === 'string').map((s) => s.trim()).filter(Boolean) : [];
}

function fail(code) {
  return { ok: false, ranked: [], error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export function rankAgentsByRelevance({ local_card, candidate_cards = [], trust_edges = null, local_agent_id = null } = {}) {
  if (!isObj(local_card) || typeof local_card.agent_id !== 'string') return fail('INVALID_LOCAL_CARD');
  if (!Array.isArray(candidate_cards)) return fail('INVALID_CANDIDATE_CARDS');

  const localTags = new Set(arr(local_card.tags));
  const localSkills = new Set(arr(local_card.skills));

  let trustMap = new Map();
  if (Array.isArray(trust_edges) && typeof local_agent_id === 'string' && local_agent_id.trim()) {
    const ts = computeTrustScore({ trust_edges, local_agent_id });
    if (ts.ok) {
      trustMap = new Map(ts.scores.map((s) => [s.agent_id, s.trust_score]));
    }
  }

  const ranked = [];

  for (const c of candidate_cards) {
    if (!isObj(c) || typeof c.agent_id !== 'string') return fail('INVALID_CANDIDATE_CARD');

    const cTags = arr(c.tags);
    const cSkills = arr(c.skills);

    let shared_tags = 0;
    for (const t of cTags) if (localTags.has(t)) shared_tags++;

    let shared_skills = 0;
    for (const s of cSkills) if (localSkills.has(s)) shared_skills++;

    const trust_score = trustMap.get(c.agent_id) || 0;

    const score = shared_tags * 2 + shared_skills * 3 + trust_score;

    ranked.push({
      agent_id: c.agent_id,
      score,
      shared_tags: cTags.filter((t) => localTags.has(t)).sort(),
      shared_skills: cSkills.filter((s) => localSkills.has(s)).sort(),
      trust_score
    });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.agent_id).localeCompare(String(b.agent_id));
  });

  return { ok: true, ranked, error: null };
}
