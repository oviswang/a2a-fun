import fs from 'node:fs/promises';

import { createTask } from './taskSchema.mjs';
import { getTasksPath, loadTasks, saveTasks } from './taskStore.mjs';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function nowIso() {
  return new Date().toISOString();
}

function parseIso(s) {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

async function readJson(path) {
  const raw = await fs.readFile(path, 'utf8');
  return JSON.parse(raw);
}

function taskMatchesTopicWithinWindow({ task, topic, windowMs, created_by } = {}) {
  try {
    if (!task || safeStr(task.topic) !== safeStr(topic)) return false;
    // Only dedup against generator-created tasks (avoid blocking human/manual tasks).
    if (created_by && safeStr(task.created_by) !== safeStr(created_by)) return false;
    const createdAt = parseIso(task.created_at);
    if (!createdAt) return false;
    return (Date.now() - createdAt) < windowMs;
  } catch {
    return false;
  }
}

function computeCadenceWindowMs(cadence) {
  // v0.1: only supports 24h
  if (cadence === '24h' || cadence === 'daily') return 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

function makeGeneratorFingerprint({ type, topic, time_window, dayKey } = {}) {
  // Deterministic, no hashing required.
  return `gen:v0.1:${safeStr(type)}:${safeStr(topic)}:${safeStr(time_window)}:${safeStr(dayKey)}`;
}

function dayKeyForIso(tsIso) {
  const d = new Date(tsIso || Date.now());
  // YYYY-MM-DD in UTC
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export async function generateTasksOnce({
  workspace_path,
  node_id,
  topics_path,
  cadence = '24h',
  max_per_run = 3
} = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  const nid = safeStr(node_id);
  if (!nid) return { ok: false, error: { code: 'MISSING_NODE_ID' } };

  const tp = topics_path ? String(topics_path) : `${ws}/task_topics.json`;
  const topicsCfg = await readJson(tp);
  const topics = Array.isArray(topicsCfg?.topics) ? topicsCfg.topics : [];

  const tasks_path = getTasksPath({ workspace_path: ws });
  const loaded = await loadTasks({ tasks_path });
  const table = loaded.table;
  const existing = Array.isArray(table.tasks) ? table.tasks : [];

  const windowMs = computeCadenceWindowMs(cadence);
  const ts = nowIso();
  const dayKey = dayKeyForIso(ts);

  const created = [];
  const skipped = [];

  for (const t of topics) {
    if (created.length >= Math.max(0, Number(max_per_run) || 0)) break;

    const topic = safeStr(t?.topic);
    const enabled = t?.enabled !== false;
    const related_topics = Array.isArray(t?.related_topics) ? t.related_topics.map(safeStr).filter(Boolean) : [];
    const time_window = safeStr(t?.time_window) || null;
    const types = Array.isArray(t?.types) ? t.types.map(safeStr).filter(Boolean) : [];

    if (!enabled || !topic || types.length === 0) continue;

    for (const type of types) {
      if (created.length >= Math.max(0, Number(max_per_run) || 0)) break;

      // Dedup rule: no duplicate tasks for same topic within cadence window
      const dup = existing.some((x) => taskMatchesTopicWithinWindow({ task: x, topic, windowMs, created_by: nid }));
      if (dup) {
        skipped.push({ topic, type, reason: 'cadence_window_dup' });
        continue;
      }

      const input = (() => {
        if (type === 'run_check') {
          return { check: 'relay_health', time_window: time_window || 'last_24h', related_topics };
        }
        if (type === 'node_diagnose') {
          return { check: 'network_diagnostics', time_window: time_window || 'last_24h', related_topics };
        }
        if (type === 'web_research') {
          return { question: 'asset market signal summary', time_window: time_window || 'last_24h', related_topics };
        }
        return { time_window: time_window || 'last_24h', related_topics };
      })();

      const made = createTask({ type, topic, created_by: nid, input });
      if (!made.ok) {
        skipped.push({ topic, type, reason: 'create_failed', error: made.error || null });
        continue;
      }

      // v0.1: set requires based on type
      if (type === 'run_check') made.task.requires = ['run_check'];
      if (type === 'node_diagnose') made.task.requires = ['node_diagnose'];
      if (type === 'web_research') made.task.requires = ['web_research'];

      // Dedup v0.1: stable fingerprint per topic/type/day
      made.task.fingerprint = makeGeneratorFingerprint({ type, topic, time_window: time_window || 'last_24h', dayKey });

      // Insert once per fingerprint (handles weird task_id collisions / prior duplicates)
      const fp = safeStr(made.task.fingerprint);
      const fpExists = fp ? existing.some((x) => safeStr(x?.fingerprint) === fp) : false;
      if (fpExists) {
        skipped.push({ topic, type, reason: 'fingerprint_exists' });
        continue;
      }

      table.tasks.push(made.task);
      existing.push(made.task);
      created.push(made.task);
    }
  }

  table.updated_at = nowIso();
  await saveTasks({ tasks_path, table });

  return {
    ok: true,
    ts,
    workspace_path: ws,
    node_id: nid,
    cadence,
    max_per_run,
    created_count: created.length,
    created,
    skipped
  };
}
