import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { publishLocalAgentCard } from '../src/discovery/networkAgentPublish.mjs';

test('publish helper: extracts docs, builds AgentCard, calls injected publish', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-agent-'));
  const agentDir = path.join(dir, 'agent');
  await fs.mkdir(agentDir);
  await fs.writeFile(path.join(agentDir, 'soul.md'), 'Name: Node A\nMission: Test\n');
  await fs.writeFile(path.join(agentDir, 'skill.md'), 'I can `echo` and `translate`\n');

  let called = false;
  const out = await publishLocalAgentCard({
    workspace_path: dir,
    agent_id: 'nodeA',
    publish: async ({ agent_id, card }) => {
      called = true;
      assert.equal(agent_id, 'nodeA');
      assert.equal(card.agent_id, 'nodeA');
      assert.deepEqual(card.skills, ['echo', 'translate']);
      return { ok: true, published: true };
    }
  });

  assert.equal(called, true);
  assert.equal(out.ok, true);
});
