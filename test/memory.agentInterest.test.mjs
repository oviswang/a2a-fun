import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { markAgentInterested } from '../src/memory/markAgentInterested.mjs';
import { getDefaultLocalAgentMemoryPath, loadLocalAgentMemory, saveLocalAgentMemory, upsertLocalAgentMemoryRecord } from '../src/memory/localAgentMemory.mjs';

test('engaged -> interested, local_human_interest=true', async () => {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-interest-'));
  const file_path = getDefaultLocalAgentMemoryPath({ workspace_path: ws });

  const base = await loadLocalAgentMemory({ file_path });
  const up = upsertLocalAgentMemoryRecord({
    records: base.records,
    patch: { legacy_agent_id: 'peer1', relationship_state: 'engaged', local_human_interest: false }
  });
  await saveLocalAgentMemory({ file_path, records: up.records });

  const out = await markAgentInterested({ workspace_path: ws, peer_agent_id: 'peer1' });
  assert.equal(out.ok, true);

  const loaded2 = await loadLocalAgentMemory({ file_path });
  const rec = loaded2.records.find((r) => r.legacy_agent_id === 'peer1');
  assert.equal(rec.relationship_state, 'interested');
  assert.equal(rec.local_human_interest, true);
  assert.equal(typeof rec.human_interest_at, 'string');
  assert.equal(rec.human_interest_at.trim() !== '', true);
});
