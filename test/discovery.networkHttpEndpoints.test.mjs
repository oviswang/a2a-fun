import test from 'node:test';
import assert from 'node:assert/strict';

import { createHttpTransport } from '../src/runtime/transport/httpTransport.mjs';

const card = (id, name) => ({
  agent_id: id,
  name,
  mission: '',
  summary: name,
  skills: [],
  tags: [],
  services: [],
  examples: []
});

test('HTTP network directory: publish/list/search endpoints are machine-safe and deterministic', async () => {
  const t = createHttpTransport();
  const srv = await t.startServer({
    port: 0,
    onMessage: async () => ({ ok: true })
  });

  try {
    const base = `http://127.0.0.1:${srv.port}`;

    // publish
    const p = await fetch(`${base}/agents/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent_id: 'nodeB', card: card('nodeB', 'OpenClaw helper') })
    });
    assert.equal(p.status, 200);
    const pj = await p.json();
    assert.equal(pj.ok, true);

    // list
    const l = await fetch(`${base}/agents`);
    assert.equal(l.status, 200);
    const lj = await l.json();
    assert.equal(lj.ok, true);
    assert.equal(lj.agents.length, 1);
    assert.equal(lj.agents[0].agent_id, 'nodeB');

    // search
    const s = await fetch(`${base}/agents/search?q=openclaw`);
    assert.equal(s.status, 200);
    const sj = await s.json();
    assert.equal(sj.ok, true);
    assert.deepEqual(sj.results.map((c) => c.agent_id), ['nodeB']);
  } finally {
    await srv.close();
  }
});
