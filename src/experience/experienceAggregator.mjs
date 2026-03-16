import fs from 'node:fs/promises';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function parseIso(s) {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function uniq(arr) {
  return [...new Set((arr || []).map(safeStr).filter(Boolean))];
}

function nowIso() {
  return new Date().toISOString();
}

async function readJson(path) {
  const raw = await fs.readFile(path, 'utf8');
  return JSON.parse(raw);
}

function computeWindowMs(window) {
  if (window === 'last_24h') return 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

function taskActor(task) {
  // Actor is the node that actually executed (preferred), else creator.
  return safeStr(task?.assigned_to) || safeStr(task?.lease?.holder) || safeStr(task?.created_by);
}

function normalizeError(task) {
  const e = task?.error;
  if (!e) return null;
  if (typeof e === 'string') return safeStr(e).slice(0, 200);
  if (typeof e === 'object') {
    const code = safeStr(e.code);
    const msg = safeStr(e.message);
    return [code, msg].filter(Boolean).join(':').slice(0, 200) || 'error';
  }
  return 'error';
}

function resultKey(task) {
  // Used for similarity grouping of completed tasks.
  const type = safeStr(task?.type);
  const topic = safeStr(task?.topic);
  const input = task?.input && typeof task.input === 'object' ? task.input : {};
  const k = safeStr(input.check) || safeStr(input.question) || '';
  return `${type}:${topic}:${k}`;
}

export async function aggregateExperience({
  workspace_path,
  tasks_path,
  window = 'last_24h'
} = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  const tp = tasks_path ? String(tasks_path) : `${ws}/data/tasks.json`;

  const windowMs = computeWindowMs(window);
  const cutoff = Date.now() - windowMs;

  const tasksTable = await readJson(tp);
  const tasks = Array.isArray(tasksTable?.tasks) ? tasksTable.tasks : [];

  const recentCompleted = tasks.filter((t) => {
    if (safeStr(t?.status) !== 'completed') return false;
    const createdAt = parseIso(t?.created_at);
    if (!createdAt) return false;
    return createdAt >= cutoff;
  });

  // Group by topic
  const byTopic = new Map();
  for (const t of recentCompleted) {
    const topic = safeStr(t?.topic) || 'unknown';
    if (!byTopic.has(topic)) byTopic.set(topic, []);
    byTopic.get(topic).push(t);
  }

  const events = [];

  for (const [topic, list] of byTopic.entries()) {
    const actors = uniq(list.map(taskActor));
    const okCount = list.filter((t) => !!t?.result && t?.result?.ok !== false).length;
    const failCount = list.length - okCount;

    // Similarity grouping (same resultKey)
    const keyCounts = new Map();
    for (const t of list) {
      const k = resultKey(t);
      keyCounts.set(k, (keyCounts.get(k) || 0) + 1);
    }
    const maxSameKey = Math.max(0, ...Array.from(keyCounts.values()));

    // Multi-node confirmation: multiple actors + multiple similar completed tasks
    if (actors.length >= 2 && maxSameKey >= 2 && okCount >= 2) {
      events.push({
        type: 'confirmation',
        topic,
        actors,
        context: {
          task_type: safeStr(list[0]?.type) || null,
          task_input: list[0]?.input && typeof list[0].input === 'object' ? list[0].input : null
        },
        summary: `${actors.length} agents confirmed ${topic} with ${okCount} completed tasks`
      });
      continue;
    }

    // Repeated failures (anomaly)
    if (failCount >= 2) {
      const errs = uniq(list.map(normalizeError).filter(Boolean));
      events.push({
        type: 'anomaly',
        topic,
        actors,
        context: {
          task_type: safeStr(list[0]?.type) || null,
          task_input: list[0]?.input && typeof list[0].input === 'object' ? list[0].input : null
        },
        summary: `${failCount} repeated failures on ${topic}`,
        details: {
          failures: failCount,
          errors: errs.slice(0, 5)
        }
      });
      continue;
    }

    // Investigation: multiple tasks but not enough for confirmation/anomaly
    if (list.length >= 2) {
      events.push({
        type: 'investigation',
        topic,
        actors,
        context: {
          task_type: safeStr(list[0]?.type) || null,
          task_input: list[0]?.input && typeof list[0].input === 'object' ? list[0].input : null
        },
        summary: `${actors.length} agents investigated ${topic} (${list.length} completed tasks)`
      });
      continue;
    }

    // Single node, single task: discovery
    events.push({
      type: 'discovery',
      topic,
      actors,
      context: {
        task_type: safeStr(list[0]?.type) || null,
        task_input: list[0]?.input && typeof list[0].input === 'object' ? list[0].input : null
      },
      summary: `${actors[0] || '1 agent'} recorded a new finding on ${topic}`
    });
  }

  // Stable output order
  events.sort((a, b) => {
    const ta = safeStr(a.topic);
    const tb = safeStr(b.topic);
    if (ta !== tb) return ta.localeCompare(tb);
    return safeStr(a.type).localeCompare(safeStr(b.type));
  });

  return {
    ok: true,
    kind: 'EXPERIENCE_AGGREGATE_V0_1',
    window,
    generated_at: nowIso(),
    source: {
      tasks_path: tp,
      completed_tasks_considered: recentCompleted.length
    },
    events
  };
}
