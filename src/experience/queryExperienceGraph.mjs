import fs from 'node:fs/promises';
import path from 'node:path';

function normKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function uniqNorm(list, limitN) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    if (typeof item !== 'string') continue;
    const raw = item.trim();
    if (!raw) continue;
    const k = normKey(raw);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(raw);
    if (typeof limitN === 'number' && out.length >= limitN) break;
  }
  return out;
}

async function readJson(p) {
  const txt = await fs.readFile(p, 'utf8');
  return JSON.parse(txt);
}

export async function queryExperienceGraph({ topic, graph_path, workspace_path } = {}) {
  const tp = String(topic || '').trim();
  const ws = String(workspace_path || '').trim() || process.cwd();
  const gp = String(graph_path || '').trim() || path.join(ws, 'data', 'experience_graph.json');

  console.log(JSON.stringify({ ok: true, event: 'EXPERIENCE_GRAPH_QUERY_STARTED', topic: tp }));

  if (!tp) {
    return { ok: false, error: { code: 'MISSING_TOPIC' } };
  }

  let graph = null;
  try {
    graph = await readJson(gp);
  } catch {
    const out = { ok: false, error: { code: 'GRAPH_NOT_FOUND', graph_path: gp } };
    console.log(JSON.stringify({ ok: true, event: 'EXPERIENCE_GRAPH_QUERY_RESULT', topic: tp, ok_result: false, records_count: 0 }));
    return out;
  }

  const bucket = graph?.topics?.[tp];
  const records = Array.isArray(bucket?.records) ? bucket.records : [];

  const knowledge = {
    what_worked: uniqNorm(records.flatMap((r) => r?.what_worked || []), 5),
    what_failed: uniqNorm(records.flatMap((r) => r?.what_failed || []), 5),
    tools_workflow: uniqNorm(records.flatMap((r) => r?.tools_workflow || []), 5),
    next_step: uniqNorm(records.flatMap((r) => r?.next_step || []), 3)
  };

  const out = { ok: true, topic: tp, records_count: records.length, knowledge, graph_path: gp };
  console.log(JSON.stringify({ ok: true, event: 'EXPERIENCE_GRAPH_QUERY_RESULT', topic: tp, ok_result: true, records_count: records.length }));
  return out;
}
