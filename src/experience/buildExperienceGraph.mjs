import fs from 'node:fs/promises';
import path from 'node:path';

import { ingestExperienceSummary } from './ingestExperienceSummary.mjs';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

async function readJson(p) {
  const txt = await fs.readFile(p, 'utf8');
  return JSON.parse(txt);
}

export async function buildExperienceGraph({ workspace_path, transcripts_dir, graph_path } = {}) {
  const ws = safeStr(workspace_path) || process.cwd();
  const tdir = safeStr(transcripts_dir) || path.join(ws, 'transcripts');
  const gpath = safeStr(graph_path) || path.join(ws, 'data', 'experience_graph.json');

  let files = [];
  try {
    files = await fs.readdir(tdir);
  } catch {
    return { ok: false, error: { code: 'TRANSCRIPTS_DIR_NOT_FOUND', transcripts_dir: tdir } };
  }

  const summaryFiles = files.filter((n) => n.endsWith('.experience_summary.json'));
  let ingested = 0;
  let deduped = 0;

  for (const name of summaryFiles) {
    const summary_path = path.join(tdir, name);

    // Best-effort metadata discovery via sibling transcript JSON
    const base = name.replace(/\.experience_summary\.json$/, '');
    const transcriptJsonPath = path.join(tdir, base + '.json');

    let meta = null;
    try {
      meta = await readJson(transcriptJsonPath);
    } catch {
      meta = null;
    }

    const topic = safeStr(meta?.conversation_goal?.topic) || safeStr(meta?.topic) || 'unknown';
    const dialogue_id = safeStr(meta?.dialogue_id) || base;
    const source_nodes = [safeStr(meta?.node_a), safeStr(meta?.node_b)].filter(Boolean);
    const timestamp = safeStr(meta?.turns?.[0]?.ts) || safeStr(meta?.created_at) || '';

    const out = await ingestExperienceSummary({
      summary_path,
      graph_path: gpath,
      topic,
      dialogue_id,
      source_nodes,
      timestamp
    });

    if (out.ok && out.deduped) deduped++;
    if (out.ok && !out.deduped) ingested++;
  }

  // Load final graph for counts
  let graph = null;
  try {
    graph = await readJson(gpath);
  } catch {
    graph = { topics: {} };
  }

  const topics_count = graph?.topics ? Object.keys(graph.topics).length : 0;
  const records_count = graph?.topics
    ? Object.values(graph.topics).reduce((acc, t) => acc + (Array.isArray(t?.records) ? t.records.length : 0), 0)
    : 0;

  return { ok: true, graph_path: gpath, topics_count, records_count, ingested, deduped };
}
