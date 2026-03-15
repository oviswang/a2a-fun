import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createHttpTransport } from '../src/runtime/transport/httpTransport.mjs';
import { computeStableAgentId } from '../src/identity/stableAgentId.mjs';

async function makeWorkspace(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-rollout-'));
  const agentDir = path.join(dir, 'agent');
  await fs.mkdir(agentDir);
  await fs.writeFile(path.join(agentDir, 'soul.md'), `Name: ${name}\nMission: Test\n`);
  await fs.writeFile(path.join(agentDir, 'skill.md'), 'I can `test`\n');
  return dir;
}

async function httpJson(url, options) {
  const r = await fetch(url, options);
  const t = await r.text();
  return { status: r.status, json: JSON.parse(t) };
}

test('rollout: publish-self uses stable_agent_id when principal env exists', async () => {
  const ws = await makeWorkspace('rollout');

  const prev = { ...process.env };
  process.env.A2A_WORKSPACE_PATH = ws;
  process.env.A2A_AGENT_ID = 'legacy-node';
  process.env.A2A_PRINCIPAL_GATEWAY = 'whatsapp';
  process.env.A2A_PRINCIPAL_ACCOUNT_ID = '+6598931276';

  const expected = computeStableAgentId({ principal_source: 'whatsapp:+6598931276', agent_slug: 'default' });
  assert.equal(expected.ok, true);

  const t = createHttpTransport();
  const srv = await t.startServer({ port: 0, onMessage: async () => ({ ok: true }) });
  const base = `http://127.0.0.1:${srv.port}`;

  const pub = await httpJson(`${base}/agents/publish-self`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(pub.status, 200);
  assert.equal(pub.json.ok, true);
  assert.equal(pub.json.stable_identity, true);
  assert.equal(pub.json.legacy_fallback, false);
  assert.equal(pub.json.agent_id, expected.stable_agent_id);

  const list = await httpJson(`${base}/agents`, { method: 'GET' });
  assert.equal(list.status, 200);
  const ids = (list.json.agents || []).map((a) => a.agent_id);
  assert.equal(ids.includes(expected.stable_agent_id), true);

  await srv.close();
  process.env = prev;
});

test('rollout: publish-self falls back to legacy id when principal missing', async () => {
  const ws = await makeWorkspace('rollout2');

  const prev = { ...process.env };
  process.env.A2A_WORKSPACE_PATH = ws;
  process.env.A2A_AGENT_ID = 'legacy-node';
  delete process.env.A2A_PRINCIPAL_GATEWAY;
  delete process.env.A2A_PRINCIPAL_ACCOUNT_ID;

  const t = createHttpTransport();
  const srv = await t.startServer({ port: 0, onMessage: async () => ({ ok: true }) });
  const base = `http://127.0.0.1:${srv.port}`;

  const pub = await httpJson(`${base}/agents/publish-self`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(pub.status, 200);
  assert.equal(pub.json.ok, true);
  assert.equal(pub.json.stable_identity, false);
  assert.equal(pub.json.legacy_fallback, true);
  assert.equal(pub.json.agent_id, 'legacy-node');

  await srv.close();
  process.env = prev;
});
