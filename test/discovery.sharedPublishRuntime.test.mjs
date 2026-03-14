import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createHttpTransport } from '../src/runtime/transport/httpTransport.mjs';
import { publishLocalAgentCardToSharedDirectory } from '../src/discovery/sharedAgentPublishRuntime.mjs';
import { listPublishedAgentsRemote } from '../src/discovery/sharedAgentDirectoryClient.mjs';

test('shared publish runtime: local docs -> AgentCard -> remote publish -> appears in shared directory', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-agent-'));
  const agentDir = path.join(workspace, 'agent');
  await fs.mkdir(agentDir);
  await fs.writeFile(path.join(agentDir, 'soul.md'), 'Name: Node A\nMission: Test\n');
  await fs.writeFile(path.join(agentDir, 'skill.md'), 'I can `openclaw`\n');

  const t = createHttpTransport();
  const srv = await t.startServer({ port: 0, onMessage: async () => ({ ok: true }) });
  const base_url = `http://127.0.0.1:${srv.port}`;

  try {
    const pub = await publishLocalAgentCardToSharedDirectory({ workspace_path: workspace, agent_id: 'nodeA', base_url });
    assert.equal(pub.ok, true);

    const list = await listPublishedAgentsRemote({ base_url });
    assert.equal(list.ok, true);
    assert.equal(list.agents[0].agent_id, 'nodeA');
  } finally {
    await srv.close();
  }
});
