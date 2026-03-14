function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function isNonEmptyString(x) {
  return typeof x === 'string' && x.trim() !== '';
}

function fail(code) {
  return { ok: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export function recommendAgentsByTrust({ trust_scores, candidates = [] } = {}) {
  if (!Array.isArray(candidates)) return fail('INVALID_CANDIDATES');
  if (!isObj(trust_scores) || trust_scores.ok !== true || !Array.isArray(trust_scores.scores)) {
    return fail('INVALID_TRUST_SCORES');
  }

  const scoreMap = new Map();
  for (const s of trust_scores.scores) {
    if (!isObj(s) || !isNonEmptyString(s.agent_id) || typeof s.trust_score !== 'number') return fail('INVALID_TRUST_SCORE');
    scoreMap.set(s.agent_id.trim(), s.trust_score);
  }

  const uniq = new Set();
  for (const c of candidates) {
    if (!isNonEmptyString(c)) return fail('INVALID_CANDIDATE');
    uniq.add(c.trim());
  }

  const recommendations = [...uniq].map((agent_id) => ({
    agent_id,
    trust_score: scoreMap.get(agent_id) || 0
  }));

  recommendations.sort((a, b) => {
    if (b.trust_score !== a.trust_score) return b.trust_score - a.trust_score;
    return String(a.agent_id).localeCompare(String(b.agent_id));
  });

  return { ok: true, recommendations };
}
