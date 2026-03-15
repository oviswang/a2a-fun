import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  loadLocalAgentMemory,
  saveLocalAgentMemory,
  upsertLocalAgentMemoryRecord,
  getDefaultLocalAgentMemoryPath
} from '../src/memory/localAgentMemory.mjs';

test('local agent memory: create empty store', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-mem-'));
  const file_path = path.join(dir, 'data', 'local_agent_memory.json');
  const out = await loadLocalAgentMemory({ file_path });
  assert.equal(out.ok, true);
  assert.deepEqual(out.records, []);
});

test('local agent memory: upsert discovered agent + deterministic listing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-mem-'));
  const file_path = path.join(dir, 'data', 'local_agent_memory.json');

  const loaded = await loadLocalAgentMemory({ file_path });
  const up = upsertLocalAgentMemoryRecord({
    records: loaded.records,
    patch: { legacy_agent_id: 'nodeB', relationship_state: 'discovered', display_name: 'B' }
  });
  assert.equal(up.ok, true);
  await saveLocalAgentMemory({ file_path, records: up.records });

  const loaded2 = await loadLocalAgentMemory({ file_path });
  assert.equal(loaded2.ok, true);
  assert.equal(loaded2.records.length, 1);
  assert.equal(loaded2.records[0].legacy_agent_id, 'nodeB');
  assert.equal(loaded2.records[0].relationship_state, 'discovered');
});

test('local agent memory: relationship_state upgrades deterministically (no downgrade)', async () => {
  const r0 = [{ legacy_agent_id: 'nodeB', relationship_state: 'engaged' }];
  const up1 = upsertLocalAgentMemoryRecord({ records: r0, patch: { legacy_agent_id: 'nodeB', relationship_state: 'discovered' } });
  assert.equal(up1.ok, true);
  assert.equal(up1.records[0].relationship_state, 'engaged');

  const up2 = upsertLocalAgentMemoryRecord({ records: up1.records, patch: { legacy_agent_id: 'nodeB', relationship_state: 'friend' } });
  assert.equal(up2.ok, true);
  assert.equal(up2.records[0].relationship_state, 'friend');
});

test('local agent memory: stable id preferred over legacy id', async () => {
  const r0 = [{ legacy_agent_id: 'VM-0-1', relationship_state: 'discovered' }];
  const stable = 'aid:sha256:' + 'a'.repeat(64);
  const up = upsertLocalAgentMemoryRecord({ records: r0, patch: { stable_agent_id: stable, legacy_agent_id: 'VM-0-1', relationship_state: 'engaged' } });
  assert.equal(up.ok, true);
  assert.equal(up.records[0].stable_agent_id, stable);
  assert.equal(up.records[0].legacy_agent_id, 'VM-0-1');
});

test('local agent memory: corrupt file fails closed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-mem-'));
  const file_path = path.join(dir, 'data', 'local_agent_memory.json');
  await fs.mkdir(path.dirname(file_path), { recursive: true });
  await fs.writeFile(file_path, '{not json');
  const out = await loadLocalAgentMemory({ file_path });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'CORRUPT_STORE');
});
