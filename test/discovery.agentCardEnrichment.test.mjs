import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { extractAgentDiscoveryDocuments } from '../src/discovery/agentDocumentExtractor.mjs';
import { buildAgentCardFromDocuments } from '../src/discovery/agentCardBuilder.mjs';
import { createHttpTransport } from '../src/runtime/transport/httpTransport.mjs';

async function makeWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-card-'));
  const agentDir = path.join(dir, 'agent');
  await fs.mkdir(agentDir);
  await fs.writeFile(path.join(agentDir, 'soul.md'), 'Name: Alpha\nMission: Help humans\n');
  await fs.writeFile(path.join(agentDir, 'about.md'), 'About Alpha\n');
  await fs.writeFile(path.join(agentDir, 'skill.md'), 'I can `translate`\n');
  return dir;
}

async function httpJson(url, options) {
  const r = await fetch(url, options);
  const t = await r.text();
  return { status: r.status, json: JSON.parse(t) };
}

test('agent card enrichment: merges doc skills + capability skills deterministically and infers tags', async () => {
  const ws = await makeWorkspace();
  const docsOut = await extractAgentDiscoveryDocuments({ workspace_path: ws });
  assert.equal(docsOut.ok, true);

  const out = buildAgentCardFromDocuments({
    documents: docsOut.documents,
    agent_id: 'aid:sha256:' + 'a'.repeat(64),
    capabilities: ['echo', 'text_transform']
  });

  assert.equal(out.ok, true);
  const c = out.agent_card;

  assert.equal(c.name, 'Alpha');
  assert.equal(c.mission, 'Help humans');
  assert.deepEqual(c.skills, ['echo', 'text_transform', 'translate']);
  assert.deepEqual(c.tags, ['text', 'translation', 'utility']);
  assert.equal(c.summary.includes('Alpha'), true);
  assert.equal(c.summary.includes('Help humans'), true);
  assert.equal(c.summary.includes('skills:'), true);
});

test('publish-self remains best-effort if /capabilities is unavailable', async () => {
  const ws = await makeWorkspace();

  const prevEnv = { ...process.env };
  process.env.A2A_WORKSPACE_PATH = ws;
  process.env.A2A_AGENT_ID = 'legacy-node';

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const s = String(url);
    if (s.endsWith('/capabilities')) throw new Error('simulated network fail');
    return prevFetch(url, opts);
  };

  const t = createHttpTransport();
  const srv = await t.startServer({ port: 0, onMessage: async () => ({ ok: true }) });
  const base = `http://127.0.0.1:${srv.port}`;

  const pub = await httpJson(`${base}/agents/publish-self`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(pub.status, 200);
  assert.equal(pub.json.ok, true);

  await srv.close();
  globalThis.fetch = prevFetch;
  process.env = prevEnv;
});
