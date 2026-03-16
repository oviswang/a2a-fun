import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { queryExperienceGraph } from '../src/experience/queryExperienceGraph.mjs';

async function writeJson(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2), 'utf8');
}

test('topic exists', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-q-'));
  const gp = path.join(tmp, 'data', 'experience_graph.json');
  await writeJson(gp, {
    ok: true,
    version: 'experience_graph.v0.1',
    topics: {
      relay: { records: [{ dialogue_id: 'd1', what_worked: ['a'], what_failed: [], tools_workflow: [], next_step: [] }] }
    }
  });
  const out = await queryExperienceGraph({ topic: 'relay', graph_path: gp, workspace_path: tmp });
  assert.equal(out.ok, true);
  assert.equal(out.records_count, 1);
  assert.deepEqual(out.knowledge.what_worked, ['a']);
});

test('topic does not exist', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-q-'));
  const gp = path.join(tmp, 'data', 'experience_graph.json');
  await writeJson(gp, { ok: true, version: 'experience_graph.v0.1', topics: {} });
  const out = await queryExperienceGraph({ topic: 'relay', graph_path: gp, workspace_path: tmp });
  assert.equal(out.ok, true);
  assert.equal(out.records_count, 0);
});

test('dedupe works (normalized)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-q-'));
  const gp = path.join(tmp, 'data', 'experience_graph.json');
  await writeJson(gp, {
    ok: true,
    version: 'experience_graph.v0.1',
    topics: {
      relay: {
        records: [
          { dialogue_id: 'd1', what_worked: ['Keep one inbound session'], what_failed: [], tools_workflow: [], next_step: [] },
          { dialogue_id: 'd2', what_worked: [' keep   one   inbound   session '], what_failed: [], tools_workflow: [], next_step: [] }
        ]
      }
    }
  });
  const out = await queryExperienceGraph({ topic: 'relay', graph_path: gp, workspace_path: tmp });
  assert.equal(out.knowledge.what_worked.length, 1);
});

test('limits enforced', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-q-'));
  const gp = path.join(tmp, 'data', 'experience_graph.json');
  const mk = (p, n) => Array.from({ length: n }, (_, i) => `${p} ${i}`);
  await writeJson(gp, {
    ok: true,
    version: 'experience_graph.v0.1',
    topics: {
      relay: {
        records: [
          {
            dialogue_id: 'd1',
            what_worked: mk('w', 20),
            what_failed: mk('f', 20),
            tools_workflow: mk('t', 20),
            next_step: mk('n', 20)
          }
        ]
      }
    }
  });
  const out = await queryExperienceGraph({ topic: 'relay', graph_path: gp, workspace_path: tmp });
  assert.equal(out.knowledge.what_worked.length, 5);
  assert.equal(out.knowledge.what_failed.length, 5);
  assert.equal(out.knowledge.tools_workflow.length, 5);
  assert.equal(out.knowledge.next_step.length, 3);
});
