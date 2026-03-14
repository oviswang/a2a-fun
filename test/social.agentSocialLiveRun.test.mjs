import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createHttpTransport } from '../src/runtime/transport/httpTransport.mjs';
import * as sharedClient from '../src/discovery/sharedAgentDirectoryClient.mjs';
import { runAgentSocialEngineLiveRun } from '../src/social/agentSocialEngineLiveRun.mjs';

async function makeWorkspace(agentId, skillWord) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-agent-'));
  const agentDir = path.join(dir, 'agent');
  await fs.mkdir(agentDir);
  await fs.writeFile(path.join(agentDir, 'soul.md'), `Name: ${agentId}\nMission: Test\n`);
  await fs.writeFile(path.join(agentDir, 'skill.md'), 'I can `' + skillWord + '`\n');
  return dir;
}

test('agent social live run: emits candidate_found when another agent exists', async () => {
  const t = createHttpTransport();
  const srv = await t.startServer({ port: 0, onMessage: async () => ({ ok: true }) });
  const base_url = `http://127.0.0.1:${srv.port}`;

  const wsA = await makeWorkspace('nodeA', 'openclaw');

  // Publish another agent directly to shared directory.
  await sharedClient.publishAgentCardRemote({
    base_url,
    agent_id: 'nodeB',
    card: { agent_id: 'nodeB', name: 'nodeB', mission: '', summary: 'openclaw automation', skills: ['openclaw'], tags: ['openclaw'], services: [], examples: [] }
  });

  const sent = [];
  const out = await runAgentSocialEngineLiveRun({
    base_url,
    workspace_path: wsA,
    agent_id: 'nodeA',
    sharedClient,
    send: async ({ message }) => {
      sent.push(message);
      return { ok: true };
    },
    context: { channel: 'telegram', chat_id: 'local' }
  });

  await srv.close();

  assert.equal(out.ok, true);
  assert.equal(out.published, true);
  assert.equal(out.social_events_emitted.includes('candidate_found'), true);
  assert.equal(sent.length >= 1, true);
});

test('agent social live run: no-candidate case is safe and does not crash', async () => {
  const t = createHttpTransport();
  const srv = await t.startServer({ port: 0, onMessage: async () => ({ ok: true }) });
  const base_url = `http://127.0.0.1:${srv.port}`;

  const wsA = await makeWorkspace('nodeA', 'openclaw');

  const out = await runAgentSocialEngineLiveRun({
    base_url,
    workspace_path: wsA,
    agent_id: 'nodeA',
    sharedClient,
    send: async () => ({ ok: true }),
    context: { channel: 'telegram', chat_id: 'local' }
  });

  await srv.close();

  assert.equal(out.ok, true);
});
