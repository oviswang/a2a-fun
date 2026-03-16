import fs from 'node:fs/promises';
import path from 'node:path';

import { cleanExperienceSummary } from './cleanExperienceSummary.mjs';
import { splitExperienceSummary } from './splitExperienceSummary.mjs';
import { filterExperienceFragments } from './filterExperienceFragments.mjs';
import { stripExperiencePrefixes } from './stripExperiencePrefixes.mjs';
import { classifyExperienceSummary } from './classifyExperienceSummary.mjs';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function arr(v) {
  // Accept legacy string arrays and new object arrays: { text, confidence_score }
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v) {
    if (typeof item === 'string') {
      const t = item.trim();
      if (t) out.push(t);
      continue;
    }
    if (item && typeof item === 'object' && typeof item.text === 'string') {
      const t = item.text.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

export function validateExperienceSummary(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: { code: 'INVALID_JSON' } };
  const out = {
    what_worked: arr(obj.what_worked),
    what_failed_or_risk: arr(obj.what_failed_or_risk),
    tools_or_workflow: arr(obj.tools_or_workflow),
    suggested_next_step: arr(obj.suggested_next_step)
  };
  return { ok: true, summary: out };
}

async function readJson(p) {
  const txt = await fs.readFile(p, 'utf8');
  return JSON.parse(txt);
}

async function writeJsonAtomic(p, obj) {
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
  const tmp = p + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, p);
}

export async function ingestExperienceSummary({
  summary_path,
  graph_path,
  topic,
  dialogue_id,
  source_nodes,
  timestamp
} = {}) {
  const sp = safeStr(summary_path);
  const gp = safeStr(graph_path);
  const tp = safeStr(topic);
  const did = safeStr(dialogue_id);

  if (!sp || !gp) return { ok: false, error: { code: 'MISSING_PATHS' } };
  if (!tp || !did) return { ok: false, error: { code: 'MISSING_METADATA' } };

  const raw = await readJson(sp);
  const v = validateExperienceSummary(raw);
  if (!v.ok) return { ok: false, error: v.error };

  let graph = { ok: true, version: 'experience_graph.v0.1', topics: {} };
  try {
    const existing = await readJson(gp);
    if (existing && typeof existing === 'object' && existing.topics && typeof existing.topics === 'object') graph = existing;
  } catch {}

  if (!graph.topics[tp]) graph.topics[tp] = { records: [] };
  const records = Array.isArray(graph.topics[tp].records) ? graph.topics[tp].records : [];

  if (records.some((r) => safeStr(r?.dialogue_id) === did)) {
    return { ok: true, deduped: true, graph_path: gp, topic: tp, dialogue_id: did };
  }

  // If graph already has fragment objects for this topic, preserve existing scores when the same text reappears.
  const existingScoreByText = new Map();
  for (const r of records) {
    for (const field of ['what_worked', 'what_failed', 'tools_workflow', 'next_step']) {
      const list = Array.isArray(r?.[field]) ? r[field] : [];
      for (const it of list) {
        if (!it || typeof it !== 'object' || typeof it.text !== 'string') continue;
        const t = it.text.trim();
        if (!t) continue;
        const cs = typeof it.confidence_score === 'number' ? it.confidence_score : 0.5;
        if (!existingScoreByText.has(t)) existingScoreByText.set(t, cs);
      }
    }
  }

  const cleaned = cleanExperienceSummary({
    what_worked: v.summary.what_worked,
    what_failed: v.summary.what_failed_or_risk,
    tools_workflow: v.summary.tools_or_workflow,
    next_step: v.summary.suggested_next_step
  });

  const split = splitExperienceSummary(cleaned);
  const filtered = filterExperienceFragments(split);
  const stripped = stripExperiencePrefixes(filtered);
  const classified = classifyExperienceSummary(stripped);

  const wrap = (list) => list.map((text) => ({ text, confidence_score: existingScoreByText.get(text) ?? 0.5 }));

  const rec = {
    dialogue_id: did,
    source_nodes: Array.isArray(source_nodes) ? source_nodes.map(safeStr).filter(Boolean) : [],
    what_worked: wrap(classified.what_worked),
    what_failed: wrap(classified.what_failed),
    tools_workflow: wrap(classified.tools_workflow),
    next_step: wrap(classified.next_step),
    timestamp: safeStr(timestamp) || new Date().toISOString(),
    source_summary_path: sp
  };

  graph.topics[tp].records = [...records, rec];

  await writeJsonAtomic(gp, graph);
  return { ok: true, deduped: false, graph_path: gp, topic: tp, dialogue_id: did, records_count: graph.topics[tp].records.length };
}
