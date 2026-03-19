import { selectCandidateReputationAware } from '../routing/reputationAwareRouting.mjs';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function containsAny(haystack, needles) {
  const h = safeStr(haystack).toLowerCase();
  if (!h) return false;
  for (const n of needles || []) {
    const t = safeStr(n).toLowerCase();
    if (!t) continue;
    if (h.includes(t)) return true;
  }
  return false;
}

function peerScore({ peer, topics } = {}) {
  const summary = safeStr(peer?.summary);
  const name = safeStr(peer?.display_name);
  const state = safeStr(peer?.relationship_state);

  let score = 0;
  if (state === 'interested') score += 4;
  else if (state === 'engaged') score += 3;
  else if (state === 'introduced') score += 2;
  else if (state === 'discovered') score += 1;

  if (containsAny(summary, topics) || containsAny(name, topics)) score += 3;
  return score;
}

export function selectRelevantPeer({ snapshot, local_memory, candidates } = {}) {
  const topics = snapshot?.current_topics || [];
  const recs = Array.isArray(local_memory?.records) ? local_memory.records : [];

  // 1) known local memory peers already topic-relevant
  const scoredLocal = recs
    .map((peer) => ({ peer, score: peerScore({ peer, topics }) }))
    .sort((a, b) => b.score - a.score);

  const topLocal = scoredLocal.find((x) => x.score > 0) || null;
  if (topLocal) {
    const id = topLocal.peer?.stable_agent_id || topLocal.peer?.legacy_agent_id || null;
    return {
      ok: true,
      selected_peer_agent_id: id,
      reason: 'local_memory_top_score',
      score: topLocal.score,
      evidence: { topics, relationship_state: topLocal.peer?.relationship_state || null }
    };
  }

  // 4) shared-directory candidates routed via reputation-aware weighted selection
  const cand = Array.isArray(candidates) ? candidates : [];
  if (cand.length > 0) {
    const routed = selectCandidateReputationAware({ candidates: cand, topics });
    if (routed.ok && routed.selected?.agent_id) {
      return {
        ok: true,
        selected_peer_agent_id: routed.selected.agent_id,
        reason: `routing:${routed.reason}`,
        score: null,
        evidence: { topics, routing: routed }
      };
    }
  }

  return { ok: false, error: { code: 'NO_RELEVANT_PEER' } };
}
