import test from 'node:test';
import assert from 'node:assert/strict';

import { scoutAgentsFromSharedDirectory } from '../src/social/agentScout.mjs';

test('agentScout: lists remote agents, removes self, returns deterministic candidates', async () => {
  const sharedClient = {
    listPublishedAgentsRemote: async () => ({
      ok: true,
      agents: [{ agent_id: 'nodeA' }, { agent_id: 'nodeC' }, { agent_id: 'nodeB' }]
    })
  };

  const out = await scoutAgentsFromSharedDirectory({
    sharedClient,
    base_url: 'https://bootstrap.a2a.fun',
    local_agent_card: { agent_id: 'nodeA' }
  });

  assert.equal(out.ok, true);
  assert.deepEqual(out.candidates, ['nodeB', 'nodeC']);
});

test('agentScout: fails closed on fetch failure', async () => {
  const sharedClient = {
    listPublishedAgentsRemote: async () => ({ ok: false, error: { code: 'X' } })
  };

  const out = await scoutAgentsFromSharedDirectory({
    sharedClient,
    base_url: 'https://bootstrap.a2a.fun',
    local_agent_card: { agent_id: 'nodeA' }
  });

  assert.equal(out.ok, false);
});
