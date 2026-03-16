import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { ingestExperienceSummary } from '../src/experience/ingestExperienceSummary.mjs';
import { applyConfidenceFeedback } from '../src/experience/applyConfidenceFeedback.mjs';
import { queryExperienceGraph } from '../src/experience/queryExperienceGraph.mjs';

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

test('new fragment gets score 0.5', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-cs-'));
  const gp = path.join(tmp, 'data', 'experience_graph.json');
  const sumPath = path.join(tmp, 's.experience_summary.json');
  await fs.writeFile(sumPath, JSON.stringify({
    what_worked: ['keep one long-running inbound relay client'],
    what_failed_or_risk: [],
    tools_or_workflow: [],
    suggested_next_step: []
  }), 'utf8');

  await ingestExperienceSummary({
    summary_path: sumPath,
    graph_path: gp,
    topic: 'relay',
    dialogue_id: 'd1',
    source_nodes: ['A', 'B'],
    timestamp: 't'
  });

  const g = await readJson(gp);
  const it = g.topics.relay.records[0].what_worked[0];
  assert.equal(it.text, 'keep one long-running inbound relay client');
  assert.equal(it.confidence_score, 0.5);
});

test('reinforcement increases score and bounded to 1.0', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-cs-'));
  const gp = path.join(tmp, 'data', 'experience_graph.json');
  await fs.mkdir(path.dirname(gp), { recursive: true });
  await fs.writeFile(gp, JSON.stringify({
    ok: true,
    version: 'experience_graph.v0.1',
    topics: {
      relay: {
        records: [
          { dialogue_id: 'd1', what_worked: [{ text: 'x', confidence_score: 0.95 }], what_failed: [], tools_workflow: [], next_step: [] }
        ]
      }
    }
  }, null, 2));

  await applyConfidenceFeedback({
    graph_path: gp,
    topic: 'relay',
    feedback: { reinforced: ['x'], contradicted: [], new_experience: [] },
    new_summary: { what_worked: [], what_failed: [], tools_workflow: [], next_step: [] }
  });

  const g = await readJson(gp);
  assert.equal(g.topics.relay.records[0].what_worked[0].confidence_score, 1.0);
});

test('contradiction decreases score and bounded to 0.0', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-cs-'));
  const gp = path.join(tmp, 'data', 'experience_graph.json');
  await fs.mkdir(path.dirname(gp), { recursive: true });
  await fs.writeFile(gp, JSON.stringify({
    ok: true,
    version: 'experience_graph.v0.1',
    topics: {
      relay: {
        records: [
          { dialogue_id: 'd1', what_failed: [{ text: 'y', confidence_score: 0.1 }], what_worked: [], tools_workflow: [], next_step: [] }
        ]
      }
    }
  }, null, 2));

  await applyConfidenceFeedback({
    graph_path: gp,
    topic: 'relay',
    feedback: { reinforced: [], contradicted: ['y'], new_experience: [] },
    new_summary: { what_worked: [], what_failed: [], tools_workflow: [], next_step: [] }
  });

  const g = await readJson(gp);
  assert.equal(g.topics.relay.records[0].what_failed[0].confidence_score, 0.0);
});

test('query sorts by score', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-cs-'));
  const gp = path.join(tmp, 'data', 'experience_graph.json');
  await fs.mkdir(path.dirname(gp), { recursive: true });
  await fs.writeFile(gp, JSON.stringify({
    ok: true,
    version: 'experience_graph.v0.1',
    topics: {
      relay: {
        records: [
          { dialogue_id: 'd1', what_worked: [{ text: 'low', confidence_score: 0.2 }, { text: 'high', confidence_score: 0.9 }], what_failed: [], tools_workflow: [], next_step: [] }
        ]
      }
    }
  }, null, 2));

  const out = await queryExperienceGraph({ topic: 'relay', graph_path: gp, workspace_path: tmp });
  assert.equal(out.ok, true);
  assert.equal(out.knowledge.what_worked[0].text, 'high');
});
