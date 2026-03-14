import test from 'node:test';
import assert from 'node:assert/strict';

import { recommendAgentsByTrust } from '../src/social/trustRecommendation.mjs';


test('trust recommendation: ranks candidates by trust desc, tie-break agent_id asc, unknown defaults to 0', () => {
  const trust_scores = {
    ok: true,
    scores: [
      { agent_id: 'nodeB', trust_score: 3 },
      { agent_id: 'nodeC', trust_score: 1 }
    ]
  };

  const out = recommendAgentsByTrust({
    trust_scores,
    candidates: ['nodeD', 'nodeC', 'nodeB', 'nodeA']
  });

  assert.equal(out.ok, true);
  assert.deepEqual(out.recommendations, [
    { agent_id: 'nodeB', trust_score: 3 },
    { agent_id: 'nodeC', trust_score: 1 },
    { agent_id: 'nodeA', trust_score: 0 },
    { agent_id: 'nodeD', trust_score: 0 }
  ]);
});

test('trust recommendation: invalid input fails closed', () => {
  assert.equal(recommendAgentsByTrust({ trust_scores: null, candidates: [] }).ok, false);
  assert.equal(recommendAgentsByTrust({ trust_scores: { ok: true, scores: [] }, candidates: [1] }).ok, false);
});
