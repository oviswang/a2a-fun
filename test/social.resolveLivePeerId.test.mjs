import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveLivePeerId } from '../src/social/resolveLivePeerId.mjs';

test('exact match preferred', async () => {
  const out = await resolveLivePeerId({
    requested_peer_id: 'peer',
    local_memory: { records: [] },
    directory_agents: [{ agent_id: 'peer' }, { agent_id: 'peer-aaaa' }]
  });
  assert.equal(out.ok, true);
  assert.equal(out.resolved_peer_id, 'peer');
  assert.equal(out.resolution_reason, 'exact_directory_match');
});

test('legacy id resolves to single suffixed live id', async () => {
  const out = await resolveLivePeerId({
    requested_peer_id: 'VM-0-17-ubuntu',
    local_memory: { records: [{ legacy_agent_id: 'VM-0-17-ubuntu', relationship_state: 'interested' }] },
    directory_agents: [{ agent_id: 'VM-0-17-ubuntu-a3f1' }]
  });
  assert.equal(out.ok, true);
  assert.equal(out.resolved_peer_id, 'VM-0-17-ubuntu-a3f1');
  assert.equal(out.resolution_reason, 'single_suffixed_directory_match');
});

test('multiple suffixed candidates choose best memory match', async () => {
  const out = await resolveLivePeerId({
    requested_peer_id: 'VM-0-17-ubuntu',
    local_memory: { records: [{ legacy_agent_id: 'VM-0-17-ubuntu', relationship_state: 'interested' }] },
    directory_agents: [{ agent_id: 'VM-0-17-ubuntu-a1' }, { agent_id: 'VM-0-17-ubuntu-b2' }]
  });
  assert.equal(out.ok, true);
  assert.ok(out.resolved_peer_id.startsWith('VM-0-17-ubuntu-'));
  assert.equal(out.resolution_reason, 'multi_suffixed_best_memory_match');
});

test('no candidate found', async () => {
  const out = await resolveLivePeerId({ requested_peer_id: 'missing', local_memory: { records: [] }, directory_agents: [] });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'NO_LIVE_PEER_MATCH');
});
