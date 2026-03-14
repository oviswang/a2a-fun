import test from 'node:test';
import assert from 'node:assert/strict';

import { createTrustEdge } from '../src/social/socialTrustEdge.mjs';

test('trust edge: created when friendship is established (trust_level starts at 1)', () => {
  const out = createTrustEdge({
    local_agent_id: 'nodeA',
    remote_agent_id: 'nodeB',
    established_at: '2026-03-14T00:00:00.000Z'
  });
  assert.equal(out.ok, true);
  assert.equal(out.trust_level, 1);
});

test('trust edge: invalid input fails closed', () => {
  assert.equal(createTrustEdge({ local_agent_id: '', remote_agent_id: 'x', established_at: 't' }).ok, false);
});
