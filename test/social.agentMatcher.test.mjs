import test from 'node:test';
import assert from 'node:assert/strict';

import { rankAgentsByRelevance } from '../src/social/agentMatcher.mjs';

test('agentMatcher: ranks by tag/skill overlap deterministically', () => {
  const local = { agent_id: 'nodeA', tags: ['openclaw', 'automation'], skills: ['translate', 'echo'] };
  const candidates = [
    { agent_id: 'nodeB', tags: ['openclaw'], skills: ['translate'] }, // score 2 + 3 = 5
    { agent_id: 'nodeC', tags: ['automation'], skills: [] } // score 2
  ];

  const out = rankAgentsByRelevance({ local_card: local, candidate_cards: candidates });
  assert.equal(out.ok, true);
  assert.deepEqual(out.ranked.map((r) => r.agent_id), ['nodeB', 'nodeC']);
  assert.equal(out.ranked[0].score, 5);
});
