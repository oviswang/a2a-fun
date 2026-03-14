import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createHttpTransport } from '../src/runtime/transport/httpTransport.mjs';

async function makeWorkspace(agentId) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-agent-'));
  const agentDir = path.join(dir, 'agent');
  await fs.mkdir(agentDir);
  await fs.writeFile(path.join(agentDir, 'soul.md'), `Name: ${agentId}\nMission: Test\n`);
  await fs.writeFile(path.join(agentDir, 'skill.md'), 'I can `openclaw`\n');
  return dir;
}

function withFetch(mock, fn) {
  const prev = globalThis.fetch;
  globalThis.fetch = mock;
  return Promise.resolve(fn()).finally(() => {
    globalThis.fetch = prev;
  });
}

const realFetch = globalThis.fetch;

test('POST /agents/publish-self: local publish works and remote publish success is reflected', async () => {
  const workspace = await makeWorkspace('nodeSelf');
  const prevEnv = { A2A_WORKSPACE_PATH: process.env.A2A_WORKSPACE_PATH, A2A_AGENT_ID: process.env.A2A_AGENT_ID };
  process.env.A2A_WORKSPACE_PATH = workspace;
  process.env.A2A_AGENT_ID = 'nodeSelf';

  const t = createHttpTransport();
  const srv = await t.startServer({ port: 0, onMessage: async () => ({ ok: true }) });

  try {
    const base = `http://127.0.0.1:${srv.port}`;
    let remoteCalled = false;

    await withFetch(async (url, init) => {
      const u = String(url);
      if (u.startsWith('https://bootstrap.a2a.fun/agents/publish')) {
        remoteCalled = true;
        return {
          ok: true,
          async json() {
            return { ok: true, published: true, agent_id: 'nodeSelf' };
          }
        };
      }
      if (u === 'https://bootstrap.a2a.fun/agents') {
        return {
          ok: true,
          async json() {
            return { ok: true, agents: [{ agent_id: 'nodeSelf' }] };
          }
        };
      }
      return realFetch(url, init);
    }, async () => {
      const r = await fetch(`${base}/agents/publish-self`, { method: 'POST' });
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.equal(j.ok, true);
      assert.equal(j.local_published, true);
      assert.equal(j.remote_published, true);
    });

    assert.equal(remoteCalled, true);
  } finally {
    await srv.close();
    process.env.A2A_WORKSPACE_PATH = prevEnv.A2A_WORKSPACE_PATH;
    process.env.A2A_AGENT_ID = prevEnv.A2A_AGENT_ID;
  }
});

test('POST /agents/publish-self: remote publish ok but not visible -> remote_published false', async () => {
  const workspace = await makeWorkspace('nodeSelf');
  const prevEnv = { A2A_WORKSPACE_PATH: process.env.A2A_WORKSPACE_PATH, A2A_AGENT_ID: process.env.A2A_AGENT_ID };
  process.env.A2A_WORKSPACE_PATH = workspace;
  process.env.A2A_AGENT_ID = 'nodeSelf';

  const t = createHttpTransport();
  const srv = await t.startServer({ port: 0, onMessage: async () => ({ ok: true }) });

  try {
    const base = `http://127.0.0.1:${srv.port}`;

    await withFetch(async (url, init) => {
      const u = String(url);
      if (u.startsWith('https://bootstrap.a2a.fun/agents/publish')) {
        return { ok: true, async json() { return { ok: true, published: true, agent_id: 'nodeSelf' }; } };
      }
      if (u === 'https://bootstrap.a2a.fun/agents') {
        return { ok: true, async json() { return { ok: true, agents: [] }; } };
      }
      return realFetch(url, init);
    }, async () => {
      const r = await fetch(`${base}/agents/publish-self`, { method: 'POST' });
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.equal(j.ok, true);
      assert.equal(j.local_published, true);
      assert.equal(j.remote_published, false);
    });
  } finally {
    await srv.close();
    process.env.A2A_WORKSPACE_PATH = prevEnv.A2A_WORKSPACE_PATH;
    process.env.A2A_AGENT_ID = prevEnv.A2A_AGENT_ID;
  }
});

test('POST /agents/publish-self: remote failure does not break local publish', async () => {
  const workspace = await makeWorkspace('nodeSelf');
  const prevEnv = { A2A_WORKSPACE_PATH: process.env.A2A_WORKSPACE_PATH, A2A_AGENT_ID: process.env.A2A_AGENT_ID };
  process.env.A2A_WORKSPACE_PATH = workspace;
  process.env.A2A_AGENT_ID = 'nodeSelf';

  const t = createHttpTransport();
  const srv = await t.startServer({ port: 0, onMessage: async () => ({ ok: true }) });

  try {
    const base = `http://127.0.0.1:${srv.port}`;
    let remoteCalled = false;

    await withFetch(async (url, init) => {
      if (String(url).startsWith('https://bootstrap.a2a.fun/agents/publish')) {
        remoteCalled = true;
        throw new Error('remote down');
      }
      return realFetch(url, init);
    }, async () => {
      const r = await fetch(`${base}/agents/publish-self`, { method: 'POST' });
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.equal(j.ok, true);
      assert.equal(j.local_published, true);
      assert.equal(j.remote_published, false);

      const list = await fetch(`${base}/agents`);
      const lj = await list.json();
      assert.equal(lj.ok, true);
      assert.equal(lj.agents.some((a) => a.agent_id === 'nodeSelf'), true);
    });

    assert.equal(remoteCalled, true);
  } finally {
    await srv.close();
    process.env.A2A_WORKSPACE_PATH = prevEnv.A2A_WORKSPACE_PATH;
    process.env.A2A_AGENT_ID = prevEnv.A2A_AGENT_ID;
  }
});
