import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { extractAgentDiscoveryDocuments } from '../src/discovery/agentDocumentExtractor.mjs';


test('extractor: handles missing docs gracefully', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-agent-'));
  await fs.mkdir(path.join(dir, 'agent'));

  const out = await extractAgentDiscoveryDocuments({ workspace_path: dir });
  assert.equal(out.ok, true);
  assert.equal(out.documents.soul, null);
  assert.deepEqual(out.documents.skills, []);
});

test('extractor: extracts backticked skills and list items deterministically', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-agent-'));
  const agentDir = path.join(dir, 'agent');
  await fs.mkdir(agentDir);
  await fs.writeFile(path.join(agentDir, 'skill.md'), 'I can do `translate` and `echo` and `translate`.\n');
  await fs.writeFile(path.join(agentDir, 'services.md'), '- http\n- relay\n');

  const out = await extractAgentDiscoveryDocuments({ workspace_path: dir });
  assert.equal(out.ok, true);
  assert.deepEqual(out.documents.skills, ['echo', 'translate']);
  assert.deepEqual(out.documents.services, ['http', 'relay']);
});
