import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createAgentProfileExchangeMessage } from '../src/social/agentProfileExchangeMessage.mjs';
import { receiveAgentProfileExchange } from '../src/social/agentProfileExchangeReceiver.mjs';
import { getDefaultLocalAgentMemoryPath, loadLocalAgentMemory, saveLocalAgentMemory, upsertLocalAgentMemoryRecord } from '../src/memory/localAgentMemory.mjs';

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

test('agent profile exchange: introduced -> engaged, sets last_dialogue_at + last_summary, saves transcript', async () => {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-pex-'));
  const file_path = getDefaultLocalAgentMemoryPath({ workspace_path: ws });

  const base = await loadLocalAgentMemory({ file_path });
  const up = upsertLocalAgentMemoryRecord({
    records: base.records,
    patch: { legacy_agent_id: 'nodeB', relationship_state: 'introduced', last_dialogue_at: null }
  });
  await saveLocalAgentMemory({ file_path, records: up.records });

  const msgOut = createAgentProfileExchangeMessage({
    dialogue_id: 'pex:test',
    turn: 1,
    from_agent_id: 'nodeB',
    to_agent_id: 'nodeA',
    name: 'B',
    mission: 'Test',
    summary: 'B summary',
    skills: ['echo'],
    current_focus: 'shipping',
    prompt: 'test',
    message: 'hello',
    timestamp: new Date().toISOString()
  });
  assert.equal(msgOut.ok, true);

  const res = await receiveAgentProfileExchange({ workspace_path: ws, payload: msgOut.message, relayUrl: null, nodeId: 'nodeA' });
  assert.equal(res.ok, true);

  const loaded2 = await loadLocalAgentMemory({ file_path });
  const rec = loaded2.records.find((r) => r.legacy_agent_id === 'nodeB');
  assert.equal(rec.relationship_state, 'engaged');
  assert.equal(!!rec.last_dialogue_at, true);
  assert.equal(typeof rec.last_summary, 'string');
  assert.equal(rec.last_summary.trim() !== '', true);

  const mdPath = path.join(ws, 'transcripts', 'profile-exchange-pex:test.md');
  const jsonPath = path.join(ws, 'transcripts', 'profile-exchange-pex:test.json');
  assert.equal(await exists(mdPath), true);
  assert.equal(await exists(jsonPath), true);
});
