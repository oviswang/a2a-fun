function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function isNonEmptyString(x) {
  return typeof x === 'string' && x.trim() !== '';
}

function fail(code) {
  return { ok: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export function computeTrustScore({ trust_edges, local_agent_id } = {}) {
  if (!isNonEmptyString(local_agent_id)) return fail('INVALID_LOCAL_AGENT_ID');
  if (!Array.isArray(trust_edges)) return fail('INVALID_TRUST_EDGES');

  const local = local_agent_id.trim();
  const counts = new Map();

  for (const e of trust_edges) {
    if (!isObj(e)) return fail('INVALID_TRUST_EDGE');

    const edge = e.ok === true && isNonEmptyString(e.local_agent_id) ? e : e;

    if (!isNonEmptyString(edge.local_agent_id) || !isNonEmptyString(edge.remote_agent_id)) {
      return fail('INVALID_TRUST_EDGE');
    }

    if (edge.local_agent_id.trim() !== local) continue;

    const remote = edge.remote_agent_id.trim();
    counts.set(remote, (counts.get(remote) || 0) + 1);
  }

  const scores = [...counts.entries()].map(([agent_id, trust_score]) => ({ agent_id, trust_score }));

  scores.sort((a, b) => {
    if (b.trust_score !== a.trust_score) return b.trust_score - a.trust_score;
    return String(a.agent_id).localeCompare(String(b.agent_id));
  });

  return { ok: true, scores };
}
