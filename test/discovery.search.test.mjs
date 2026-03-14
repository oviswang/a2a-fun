import test from 'node:test';
import assert from 'node:assert/strict';

import { searchAgents } from '../src/discovery/agentSearch.mjs';

const mk = (agent_id, name, tags = []) => ({
  agent_id,
  name,
  mission: '',
  summary: '',
  skills: [],
  tags,
  services: [],
  examples: []
});

test('keyword search: matches across name/tags and is deterministic', () => {
  const cards = [mk('nodeB', 'B', ['openclaw']), mk('nodeA', 'Alpha', ['automation'])];
  const out = searchAgents({ agent_cards: cards, query: 'openclaw' });
  assert.equal(out.ok, true);
  assert.deepEqual(out.results.map((c) => c.agent_id), ['nodeB']);
});

test('trust ordering: applies when trust_edges available', () => {
  const cards = [mk('nodeB', 'B'), mk('nodeC', 'C'), mk('nodeD', 'D')];
  const trust_edges = [
    { ok: true, local_agent_id: 'nodeA', remote_agent_id: 'nodeC', established_at: 't', trust_level: 1 },
    { ok: true, local_agent_id: 'nodeA', remote_agent_id: 'nodeC', established_at: 't', trust_level: 1 },
    { ok: true, local_agent_id: 'nodeA', remote_agent_id: 'nodeB', established_at: 't', trust_level: 1 }
  ];

  const out = searchAgents({ agent_cards: cards, query: '', trust_edges, local_agent_id: 'nodeA' });
  assert.equal(out.ok, true);
  assert.deepEqual(out.results.map((c) => c.agent_id), ['nodeC', 'nodeB', 'nodeD']);
});


test('search: invalid input fails closed', () => {
  assert.equal(searchAgents({ agent_cards: null, query: '' }).ok, false);
  assert.equal(searchAgents({ agent_cards: [], query: 1 }).ok, false);
});
