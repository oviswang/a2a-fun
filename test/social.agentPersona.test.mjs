import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { extractAgentPersona } from '../src/social/agentPersona.mjs';

async function makeWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-persona-'));
  const agentDir = path.join(dir, 'agent');
  await fs.mkdir(agentDir);
  await fs.writeFile(path.join(agentDir, 'soul.md'), 'Name: Alice\nMission: Test\nStyle: concise\n');
  await fs.writeFile(path.join(agentDir, 'profile.md'), 'Interests: `ai` `network`\n');
  await fs.writeFile(path.join(agentDir, 'current.md'), 'Current_Focus: shipping\n');
  return dir;
}

test('extractAgentPersona: parses fields deterministically', async () => {
  const ws = await makeWorkspace();
  const out = await extractAgentPersona({ workspace_path: ws, agent_id: 'nodeA' });
  assert.equal(out.ok, true);
  assert.equal(out.persona.agent_id, 'nodeA');
  assert.equal(out.persona.name, 'Alice');
  assert.equal(out.persona.mission, 'Test');
  assert.equal(out.persona.style, 'concise');
  assert.equal(out.persona.current_focus, 'shipping');
  assert.deepEqual(out.persona.interests, ['ai', 'network']);
});
