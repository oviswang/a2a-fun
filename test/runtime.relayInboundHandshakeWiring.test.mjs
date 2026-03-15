import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createRelayInboundHandler } from '../src/runtime/transport/relayInboundHandler.mjs';
import { createAgentHandshakeMessage } from '../src/social/agentHandshakeMessage.mjs';
import { getDefaultLocalAgentMemoryPath, loadLocalAgentMemory, saveLocalAgentMemory, upsertLocalAgentMemoryRecord } from '../src/memory/localAgentMemory.mjs';

test('relay inbound handler applies AGENT_HANDSHAKE and upgrades local memory to introduced', async () => {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-relay-in-'));
  const file_path = getDefaultLocalAgentMemoryPath({ workspace_path: ws });

  const base = await loadLocalAgentMemory({ file_path });
  const up = upsertLocalAgentMemoryRecord({
    records: base.records,
    patch: { legacy_agent_id: 'nodeB', relationship_state: 'discovered', last_handshake_at: null }
  });
  await saveLocalAgentMemory({ file_path, records: up.records });

  const msgOut = createAgentHandshakeMessage({
    from_agent_id: 'nodeB',
    to_agent_id: 'nodeA',
    name: 'B',
    mission: 'Test',
    skills: ['echo'],
    timestamp: new Date().toISOString()
  });
  assert.equal(msgOut.ok, true);

  const handle = createRelayInboundHandler({ workspace_path: ws });
  const res = await handle({ from: 'nodeB', payload: msgOut.message });
  assert.equal(res.ok, true);
  assert.equal(res.handled, true);

  const loaded2 = await loadLocalAgentMemory({ file_path });
  const rec = loaded2.records.find((r) => r.legacy_agent_id === 'nodeB');
  assert.equal(rec.relationship_state, 'introduced');
  assert.equal(!!rec.last_handshake_at, true);
});
