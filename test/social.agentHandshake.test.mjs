import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createAgentHandshakeMessage } from '../src/social/agentHandshakeMessage.mjs';
import { receiveAgentHandshake } from '../src/social/agentHandshakeReceiver.mjs';
import { getDefaultLocalAgentMemoryPath, loadLocalAgentMemory, saveLocalAgentMemory, upsertLocalAgentMemoryRecord } from '../src/memory/localAgentMemory.mjs';

test('agent handshake: discovered -> introduced transition', async () => {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-hs-'));
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

  const rx = await receiveAgentHandshake({ workspace_path: ws, message: msgOut.message });
  assert.equal(rx.ok, true);

  const loaded2 = await loadLocalAgentMemory({ file_path });
  const rec = loaded2.records.find((r) => r.legacy_agent_id === 'nodeB');
  assert.equal(rec.relationship_state, 'introduced');
  assert.equal(!!rec.last_handshake_at, true);
});
