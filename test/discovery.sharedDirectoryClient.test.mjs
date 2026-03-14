import test from 'node:test';
import assert from 'node:assert/strict';

import { createHttpTransport } from '../src/runtime/transport/httpTransport.mjs';
import { publishAgentCardRemote, listPublishedAgentsRemote, searchPublishedAgentsRemote } from '../src/discovery/sharedAgentDirectoryClient.mjs';

const card = (id, summary) => ({
  agent_id: id,
  name: id,
  mission: '',
  summary,
  skills: [],
  tags: [],
  services: [],
  examples: []
});

test('shared directory client: remote publish/list/search works against test server', async () => {
  const t = createHttpTransport();
  const srv = await t.startServer({ port: 0, onMessage: async () => ({ ok: true }) });
  const base_url = `http://127.0.0.1:${srv.port}`;

  try {
    const p = await publishAgentCardRemote({ base_url, agent_id: 'nodeB', card: card('nodeB', 'openclaw automation') });
    assert.equal(p.ok, true);

    const l = await listPublishedAgentsRemote({ base_url });
    assert.equal(l.ok, true);
    assert.equal(l.agents.length, 1);

    const s = await searchPublishedAgentsRemote({ base_url, query: 'openclaw' });
    assert.equal(s.ok, true);
    assert.deepEqual(s.results.map((c) => c.agent_id), ['nodeB']);
  } finally {
    await srv.close();
  }
});

test('shared directory client: invalid input fails closed', async () => {
  const out = await listPublishedAgentsRemote({ base_url: 'not-a-url' });
  assert.equal(out.ok, false);
});
