import test from 'node:test';
import assert from 'node:assert/strict';

import { createAgentCard, isAgentCard } from '../src/discovery/agentCard.mjs';

test('AgentCard: creation deterministic and machine-safe', () => {
  const out = createAgentCard({
    agent_id: 'nodeA',
    soul: 'Name: A\nMission: Help\n',
    skills: ['translate', 'echo'],
    about: 'A helpful agent',
    services: ['http'],
    examples: ['do x']
  });

  assert.equal(out.ok, true);
  assert.deepEqual(Object.keys(out.agent_card), ['agent_id', 'name', 'mission', 'summary', 'skills', 'tags', 'services', 'examples']);
  assert.equal(isAgentCard(out.agent_card), true);
});

test('AgentCard: invalid input fails closed', () => {
  assert.equal(createAgentCard({}).ok, false);
  assert.equal(createAgentCard({ agent_id: 'x', skills: 'nope' }).ok, false);
});
