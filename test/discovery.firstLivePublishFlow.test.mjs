import test from 'node:test';
import assert from 'node:assert/strict';

import { createNetworkAgentDirectory, publishAgentCard, searchPublishedAgents } from '../src/discovery/networkAgentDirectory.mjs';
import { createNetworkAgentDirectoryEntry } from '../src/discovery/networkAgentDirectoryEntry.mjs';
import { runFirstLivePublishFlow } from '../src/discovery/firstLivePublishFlow.mjs';

const mkCard = (agent_id, name, summary) => ({
  agent_id,
  name,
  mission: '',
  summary,
  skills: [],
  tags: [],
  services: [],
  examples: []
});

test('first live publish flow: publishes A+B, search finds B, emits discovered_agent event (deterministic)', async () => {
  const directory = createNetworkAgentDirectory();
  const emitted = [];

  async function publishSelf({ agent_id }) {
    const card = agent_id === 'nodeA'
      ? mkCard('nodeA', 'Node A', 'publishes')
      : mkCard('nodeB', 'Node B', 'openclaw automation');

    const entryOut = createNetworkAgentDirectoryEntry({ agent_id, published_at: 't', card });
    if (!entryOut.ok) return entryOut;
    return publishAgentCard({ directory, entry: entryOut.entry });
  }

  async function search({ query }) {
    return searchPublishedAgents({ directory, query });
  }

  async function emitSocialFeed({ event }) {
    emitted.push(event.event_type);
  }

  const out = await runFirstLivePublishFlow({ directory, publishSelf, search, emitSocialFeed, nowIso: '2026-03-14T00:00:00.000Z' });

  assert.equal(out.ok, true);
  assert.deepEqual(out.published_agents, ['nodeA', 'nodeB']);
  assert.deepEqual(out.discovered_agents, ['nodeB']);
  assert.deepEqual(out.social_events_emitted, ['discovered_agent']);
  assert.deepEqual(emitted, ['discovered_agent']);
});

test('first live publish flow: invalid input fails closed', async () => {
  const out = await runFirstLivePublishFlow({ directory: null });
  assert.equal(out.ok, false);
});
