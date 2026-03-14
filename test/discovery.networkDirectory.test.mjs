import test from 'node:test';
import assert from 'node:assert/strict';

import { createNetworkAgentDirectory, publishAgentCard, listPublishedAgents, searchPublishedAgents } from '../src/discovery/networkAgentDirectory.mjs';
import { createNetworkAgentDirectoryEntry } from '../src/discovery/networkAgentDirectoryEntry.mjs';

const card = (id, name) => ({
  agent_id: id,
  name,
  mission: '',
  summary: '',
  skills: [],
  tags: [],
  services: [],
  examples: []
});

test('network directory: publish replaces same agent_id deterministically', () => {
  const directory = createNetworkAgentDirectory();

  const e1 = createNetworkAgentDirectoryEntry({ agent_id: 'nodeA', published_at: 't1', card: card('nodeA', 'A1') });
  assert.equal(e1.ok, true);
  publishAgentCard({ directory, entry: e1.entry });

  const e2 = createNetworkAgentDirectoryEntry({ agent_id: 'nodeA', published_at: 't2', card: card('nodeA', 'A2') });
  publishAgentCard({ directory, entry: e2.entry });

  const out = listPublishedAgents({ directory });
  assert.equal(out.ok, true);
  assert.equal(out.agents.length, 1);
  assert.equal(out.agents[0].name, 'A2');
});

test('network directory: search across published cards works (deterministic)', () => {
  const directory = createNetworkAgentDirectory();
  publishAgentCard({
    directory,
    entry: createNetworkAgentDirectoryEntry({ agent_id: 'nodeB', published_at: 't', card: card('nodeB', 'OpenClaw helper') }).entry
  });
  publishAgentCard({
    directory,
    entry: createNetworkAgentDirectoryEntry({ agent_id: 'nodeC', published_at: 't', card: card('nodeC', 'Other') }).entry
  });

  const out = searchPublishedAgents({ directory, query: 'openclaw' });
  assert.equal(out.ok, true);
  assert.deepEqual(out.results.map((c) => c.agent_id), ['nodeB']);
});


test('network directory: trust-aware ordering applied when trust data provided', () => {
  const directory = createNetworkAgentDirectory();
  publishAgentCard({
    directory,
    entry: createNetworkAgentDirectoryEntry({ agent_id: 'nodeB', published_at: 't', card: card('nodeB', 'B') }).entry
  });
  publishAgentCard({
    directory,
    entry: createNetworkAgentDirectoryEntry({ agent_id: 'nodeC', published_at: 't', card: card('nodeC', 'C') }).entry
  });

  const trust_edges = [
    { ok: true, local_agent_id: 'nodeA', remote_agent_id: 'nodeC', established_at: 't', trust_level: 1 },
    { ok: true, local_agent_id: 'nodeA', remote_agent_id: 'nodeC', established_at: 't', trust_level: 1 },
    { ok: true, local_agent_id: 'nodeA', remote_agent_id: 'nodeB', established_at: 't', trust_level: 1 }
  ];

  const out = searchPublishedAgents({ directory, query: '', trust_edges, local_agent_id: 'nodeA' });
  assert.equal(out.ok, true);
  assert.deepEqual(out.results.map((c) => c.agent_id), ['nodeC', 'nodeB']);
});
