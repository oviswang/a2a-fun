import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { ingestExperienceSummary } from '../src/experience/ingestExperienceSummary.mjs';
import { buildExperienceGraph } from '../src/experience/buildExperienceGraph.mjs';

async function writeJson(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2), 'utf8');
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

test('ingest one record then dedupe by dialogue_id', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-exp-'));
  const summaries = path.join(tmp, 'transcripts');
  const graph = path.join(tmp, 'data', 'experience_graph.json');

  const sumPath = path.join(summaries, 'x.experience_summary.json');
  await writeJson(sumPath, {
    what_worked: ['a'],
    what_failed_or_risk: ['b'],
    tools_or_workflow: ['c'],
    suggested_next_step: ['d']
  });

  const out1 = await ingestExperienceSummary({
    summary_path: sumPath,
    graph_path: graph,
    topic: 'relay',
    dialogue_id: 'dlg1',
    source_nodes: ['A', 'B'],
    timestamp: 't'
  });
  assert.equal(out1.ok, true);
  assert.equal(out1.deduped, false);

  const out2 = await ingestExperienceSummary({
    summary_path: sumPath,
    graph_path: graph,
    topic: 'relay',
    dialogue_id: 'dlg1',
    source_nodes: ['A', 'B'],
    timestamp: 't'
  });
  assert.equal(out2.ok, true);
  assert.equal(out2.deduped, true);

  const g = await readJson(graph);
  assert.equal(g.topics.relay.records.length, 1);
});

test('build graph from multiple summaries by scanning transcripts', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-exp-'));
  const tdir = path.join(tmp, 'transcripts');
  const graph = path.join(tmp, 'data', 'experience_graph.json');

  // summary 1 + transcript meta
  await writeJson(path.join(tdir, 'goal-dialogue-gx:1.experience_summary.json'), {
    what_worked: ['w1'],
    what_failed_or_risk: [],
    tools_or_workflow: ['/nodes'],
    suggested_next_step: ['n1']
  });
  await writeJson(path.join(tdir, 'goal-dialogue-gx:1.json'), {
    dialogue_id: 'gx:1',
    node_a: 'A',
    node_b: 'B',
    conversation_goal: { topic: 'relay' },
    turns: [{ ts: '2026-01-01T00:00:00Z' }]
  });

  // summary 2 + transcript meta
  await writeJson(path.join(tdir, 'goal-dialogue-gx:2.experience_summary.json'), {
    what_worked: ['w2'],
    what_failed_or_risk: ['f2'],
    tools_or_workflow: [],
    suggested_next_step: []
  });
  await writeJson(path.join(tdir, 'goal-dialogue-gx:2.json'), {
    dialogue_id: 'gx:2',
    node_a: 'C',
    node_b: 'D',
    conversation_goal: { topic: 'relay' },
    turns: [{ ts: '2026-01-02T00:00:00Z' }]
  });

  const out = await buildExperienceGraph({ workspace_path: tmp, transcripts_dir: tdir, graph_path: graph });
  assert.equal(out.ok, true);

  const g = await readJson(graph);
  assert.equal(g.topics.relay.records.length, 2);
});
