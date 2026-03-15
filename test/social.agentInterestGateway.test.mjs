import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { registerPendingInterestPrompt, handleInterestDecision } from '../src/social/agentInterestDecisionHandler.mjs';
import { getDefaultLocalAgentMemoryPath, loadLocalAgentMemory, saveLocalAgentMemory, upsertLocalAgentMemoryRecord } from '../src/memory/localAgentMemory.mjs';

test('interest gateway decision: reply 1 => interested', async () => {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-intgw-'));
  const file_path = getDefaultLocalAgentMemoryPath({ workspace_path: ws });

  const base = await loadLocalAgentMemory({ file_path });
  const up = upsertLocalAgentMemoryRecord({
    records: base.records,
    patch: { legacy_agent_id: 'peer1', relationship_state: 'engaged', local_human_interest: false }
  });
  await saveLocalAgentMemory({ file_path, records: up.records });

  registerPendingInterestPrompt({ peer_agent_id: 'peer1', last_summary: 'x' });
  const out = await handleInterestDecision({ workspace_path: ws, peer_agent_id: 'peer1', text: '1' });
  assert.equal(out.ok, true);
  assert.equal(out.decision, 'interested');

  const loaded2 = await loadLocalAgentMemory({ file_path });
  const rec = loaded2.records.find((r) => r.legacy_agent_id === 'peer1');
  assert.equal(rec.relationship_state, 'interested');
  assert.equal(rec.local_human_interest, true);
});

test('interest gateway decision: reply 2 => skip (remains engaged)', async () => {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-intgw-'));
  const file_path = getDefaultLocalAgentMemoryPath({ workspace_path: ws });

  const base = await loadLocalAgentMemory({ file_path });
  const up = upsertLocalAgentMemoryRecord({
    records: base.records,
    patch: { legacy_agent_id: 'peer2', relationship_state: 'engaged', local_human_interest: false }
  });
  await saveLocalAgentMemory({ file_path, records: up.records });

  registerPendingInterestPrompt({ peer_agent_id: 'peer2', last_summary: 'x' });
  const out = await handleInterestDecision({ workspace_path: ws, peer_agent_id: 'peer2', text: '2' });
  assert.equal(out.ok, true);
  assert.equal(out.decision, 'skip');

  const loaded2 = await loadLocalAgentMemory({ file_path });
  const rec = loaded2.records.find((r) => r.legacy_agent_id === 'peer2');
  assert.equal(rec.relationship_state, 'engaged');
  assert.equal(rec.local_human_interest, false);
});
