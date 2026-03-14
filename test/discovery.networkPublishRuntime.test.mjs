import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { publishLocalAgentCardRuntime } from '../src/discovery/networkAgentPublishRuntime.mjs';
import { createHttpTransport } from '../src/runtime/transport/httpTransport.mjs';


test('publish runtime helper: publishes from local docs via injected publish', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-agent-'));
  const agentDir = path.join(dir, 'agent');
  await fs.mkdir(agentDir);
  await fs.writeFile(path.join(agentDir, 'soul.md'), 'Name: Node A\nMission: Test\n');
  await fs.writeFile(path.join(agentDir, 'skill.md'), 'I can `echo`\n');

  let published = false;
  const out = await publishLocalAgentCardRuntime({
    workspace_path: dir,
    agent_id: 'nodeA',
    publish: async ({ agent_id, card }) => {
      published = true;
      assert.equal(agent_id, 'nodeA');
      assert.equal(card.agent_id, 'nodeA');
      return { ok: true };
    }
  });

  assert.equal(published, true);
  assert.equal(out.ok, true);
  assert.equal(out.published, true);
});

test('optional POST /agents/publish-self builds local AgentCard and publishes into directory', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-agent-'));
  const agentDir = path.join(dir, 'agent');
  await fs.mkdir(agentDir);
  await fs.writeFile(path.join(agentDir, 'soul.md'), 'Name: Node Self\nMission: Test\n');
  await fs.writeFile(path.join(agentDir, 'skill.md'), 'I can `translate`\n');

  const prev = { A2A_WORKSPACE_PATH: process.env.A2A_WORKSPACE_PATH, A2A_AGENT_ID: process.env.A2A_AGENT_ID };
  process.env.A2A_WORKSPACE_PATH = dir;
  process.env.A2A_AGENT_ID = 'nodeSelf';

  const t = createHttpTransport();
  const srv = await t.startServer({ port: 0, onMessage: async () => ({ ok: true }) });

  try {
    const base = `http://127.0.0.1:${srv.port}`;

    const r = await fetch(`${base}/agents/publish-self`, { method: 'POST' });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.ok, true);
    assert.equal(j.published, true);

    const l = await fetch(`${base}/agents`);
    const lj = await l.json();
    assert.equal(lj.ok, true);
    assert.equal(lj.agents[0].agent_id, 'nodeSelf');
  } finally {
    await srv.close();
    process.env.A2A_WORKSPACE_PATH = prev.A2A_WORKSPACE_PATH;
    process.env.A2A_AGENT_ID = prev.A2A_AGENT_ID;
  }
});
