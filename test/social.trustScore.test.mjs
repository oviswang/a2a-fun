import test from 'node:test';
import assert from 'node:assert/strict';

import { computeTrustScore } from '../src/social/trustScore.mjs';

test('trust score: counts trust edges per remote agent (+1 per edge) and sorts deterministically', () => {
  const edges = [
    { ok: true, local_agent_id: 'nodeA', remote_agent_id: 'nodeB', established_at: 't', trust_level: 1 },
    { ok: true, local_agent_id: 'nodeA', remote_agent_id: 'nodeB', established_at: 't', trust_level: 1 },
    { ok: true, local_agent_id: 'nodeA', remote_agent_id: 'nodeC', established_at: 't', trust_level: 1 },
    { ok: true, local_agent_id: 'nodeX', remote_agent_id: 'nodeB', established_at: 't', trust_level: 1 }
  ];

  const out = computeTrustScore({ trust_edges: edges, local_agent_id: 'nodeA' });
  assert.equal(out.ok, true);
  assert.deepEqual(out.scores, [
    { agent_id: 'nodeB', trust_score: 2 },
    { agent_id: 'nodeC', trust_score: 1 }
  ]);
});

test('trust score: invalid input fails closed', () => {
  assert.equal(computeTrustScore({ trust_edges: 'x', local_agent_id: 'nodeA' }).ok, false);
  assert.equal(computeTrustScore({ trust_edges: [], local_agent_id: '' }).ok, false);
});
