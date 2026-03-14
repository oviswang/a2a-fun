import { computeTrustScore } from './trustScore.mjs';
import { recommendAgentsByTrust } from './trustRecommendation.mjs';

export function rankCandidatesByTrust({ trust_edges = [], local_agent_id, candidates = [] } = {}) {
  const scores = computeTrustScore({ trust_edges, local_agent_id });
  if (!scores.ok) return scores;

  return recommendAgentsByTrust({ trust_scores: scores, candidates });
}
