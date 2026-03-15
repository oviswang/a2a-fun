import test from 'node:test';
import assert from 'node:assert/strict';

import { selectRelevantPeer } from '../src/attention/selectRelevantPeer.mjs';

test('selectRelevantPeer prefers interested/engaged local memory peers', () => {
  const snapshot = { current_topics: ['relay'] };
  const local_memory = {
    records: [
      { legacy_agent_id: 'peerA', relationship_state: 'discovered', summary: 'random' },
      { legacy_agent_id: 'peerB', relationship_state: 'interested', summary: 'relay runtime debugging' }
    ]
  };

  const out = selectRelevantPeer({ snapshot, local_memory, candidates: [] });
  assert.equal(out.ok, true);
  assert.equal(out.selected_peer_agent_id, 'peerB');
  assert.equal(out.reason, 'local_memory_top_score');
});
