import fs from 'node:fs/promises';
import path from 'node:path';

function normKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

async function readJson(p) {
  const txt = await fs.readFile(p, 'utf8');
  return JSON.parse(txt);
}

async function writeJsonAtomic(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, p);
}

function adjustList(list, changes) {
  const arr = Array.isArray(list) ? list : [];
  for (const it of arr) {
    if (!it || typeof it !== 'object' || typeof it.text !== 'string') continue;
    const k = normKey(it.text);
    if (!k) continue;
    if (!changes.has(k)) continue;
    const delta = changes.get(k);
    const cs = typeof it.confidence_score === 'number' ? it.confidence_score : 0.5;
    it.confidence_score = clamp01(cs + delta);
  }
}

export async function applyConfidenceFeedback({ graph_path, topic, feedback, new_summary } = {}) {
  const gp = String(graph_path || '').trim();
  const tp = String(topic || '').trim();
  if (!gp || !tp) return { ok: false, error: { code: 'MISSING_INPUTS' } };

  let graph = null;
  try {
    graph = await readJson(gp);
  } catch {
    return { ok: false, error: { code: 'GRAPH_NOT_FOUND', graph_path: gp } };
  }

  const bucket = graph?.topics?.[tp];
  const records = Array.isArray(bucket?.records) ? bucket.records : [];

  const changes = new Map();
  for (const k of Array.isArray(feedback?.reinforced) ? feedback.reinforced : []) changes.set(normKey(k), 0.1);
  for (const k of Array.isArray(feedback?.contradicted) ? feedback.contradicted : []) changes.set(normKey(k), -0.2);

  // Apply deltas across all records for the topic
  for (const r of records) {
    adjustList(r.what_worked, changes);
    adjustList(r.what_failed, changes);
    adjustList(r.tools_workflow, changes);
    adjustList(r.next_step, changes);
  }

  // Ensure new experience items exist somewhere (default score 0.5).
  // Minimal approach: append to the latest record if it exists.
  const latest = records[records.length - 1];
  if (latest && new_summary && typeof new_summary === 'object') {
    const ensure = (field, items) => {
      const list = Array.isArray(latest[field]) ? latest[field] : (latest[field] = []);
      const existing = new Set(list.map((it) => (it && typeof it.text === 'string') ? normKey(it.text) : '').filter(Boolean));
      for (const s of Array.isArray(items) ? items : []) {
        const k = normKey(s);
        if (!k || existing.has(k)) continue;
        list.push({ text: String(s).trim(), confidence_score: 0.5 });
        existing.add(k);
      }
    };

    ensure('what_worked', new_summary.what_worked);
    ensure('what_failed', new_summary.what_failed);
    ensure('tools_workflow', new_summary.tools_workflow);
    ensure('next_step', new_summary.next_step);
  }

  await writeJsonAtomic(gp, graph);
  return { ok: true, graph_path: gp, topic: tp };
}
