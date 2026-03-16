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

function deriveActivityPhrase({ task_type, task_input, topic } = {}) {
  const tt = safeStr(task_type);
  const ti = task_input && typeof task_input === 'object' ? task_input : {};
  const t = safeStr(topic);

  if (tt === 'run_check') {
    const check = safeStr(ti.check);
    if (check === 'relay_health') return 'checking relay health';
    if (check) return `running ${check.replace(/_/g, ' ')} checks`;
    return 'running checks';
  }

  if (tt === 'node_diagnose') {
    const check = safeStr(ti.check);
    if (check === 'network_diagnostics') return 'investigating network diagnostics';
    if (check) return `diagnosing ${check.replace(/_/g, ' ')}`;
    return 'diagnosing the node';
  }

  if (tt === 'web_research') {
    const q = safeStr(ti.question);
    if (q) return `researching ${q}`;
    if (t) return `researching ${t.replace(/_/g, ' ')}`;
    return 'researching';
  }

  if (tt === 'query') {
    const q = safeStr(ti.question);
    if (q) return `querying: ${q}`;
    return 'querying';
  }

  return tt ? `working on ${tt.replace(/_/g, ' ')}` : 'working';
}

function deriveOutcomePhrase(eventType) {
  const et = safeStr(eventType);
  if (et === 'confirmation') return 'found consistent results';
  if (et === 'anomaly') return 'reported repeated failures';
  if (et === 'discovery') return 'noticed a new pattern';
  if (et === 'investigation') return 'looked into the issue further';
  return 'made progress';
}

function deriveCollaborationHint({ eventType, actors } = {}) {
  const et = safeStr(eventType);
  const n = Array.isArray(actors) ? uniq(actors).length : 0;
  if (n >= 2 && et === 'confirmation') return `${n} agents independently confirmed the result`;
  if (n >= 2) return `${n} agents joined the same effort`;
  return null;
}

function deriveNoveltyHint({ eventType, actorsCount, failCount, maxSameKey, okCount } = {}) {
  const et = safeStr(eventType);
  if (et === 'discovery' && (actorsCount || 0) === 1) return 'first new observation in the last 24h';
  if (et === 'anomaly' && (failCount || 0) >= 2) return 'repeated pattern';
  // Conflicting outcomes heuristic: same topic had both ok and failures.
  if ((okCount || 0) >= 1 && (failCount || 0) >= 1) return 'conflicting reports';
  if ((maxSameKey || 0) >= 3) return 'repeated pattern';
  return null;
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
      {
        const task_type = safeStr(list[0]?.type) || null;
        const task_input = list[0]?.input && typeof list[0].input === 'object' ? list[0].input : null;
        const eventType = 'confirmation';
        events.push({
          type: eventType,
          topic,
          actors,
          context: { task_type, task_input },
          activity_phrase: deriveActivityPhrase({ task_type, task_input, topic }),
          outcome_phrase: deriveOutcomePhrase(eventType),
          collaboration_hint: deriveCollaborationHint({ eventType, actors }),
          novelty_hint: deriveNoveltyHint({ eventType, actorsCount: actors.length, failCount, maxSameKey, okCount }),
          summary: `${actors.length} agents confirmed ${topic} with ${okCount} completed tasks`
        });
      }
      continue;
    }

    // Repeated failures (anomaly)
    if (failCount >= 2) {
      const errs = uniq(list.map(normalizeError).filter(Boolean));
      {
        const task_type = safeStr(list[0]?.type) || null;
        const task_input = list[0]?.input && typeof list[0].input === 'object' ? list[0].input : null;
        const eventType = 'anomaly';
        events.push({
          type: eventType,
          topic,
          actors,
          context: { task_type, task_input },
          activity_phrase: deriveActivityPhrase({ task_type, task_input, topic }),
          outcome_phrase: deriveOutcomePhrase(eventType),
          collaboration_hint: deriveCollaborationHint({ eventType, actors }),
          novelty_hint: deriveNoveltyHint({ eventType, actorsCount: actors.length, failCount, maxSameKey, okCount }),
          summary: `${failCount} repeated failures on ${topic}`,
          details: {
            failures: failCount,
            errors: errs.slice(0, 5)
          }
        });
      }
      continue;
    }

    // Investigation: multiple tasks but not enough for confirmation/anomaly
    if (list.length >= 2) {
      {
        const task_type = safeStr(list[0]?.type) || null;
        const task_input = list[0]?.input && typeof list[0].input === 'object' ? list[0].input : null;
        const eventType = 'investigation';
        events.push({
          type: eventType,
          topic,
          actors,
          context: { task_type, task_input },
          activity_phrase: deriveActivityPhrase({ task_type, task_input, topic }),
          outcome_phrase: deriveOutcomePhrase(eventType),
          collaboration_hint: deriveCollaborationHint({ eventType, actors }),
          novelty_hint: deriveNoveltyHint({ eventType, actorsCount: actors.length, failCount, maxSameKey, okCount }),
          summary: `${actors.length} agents investigated ${topic} (${list.length} completed tasks)`
        });
      }
      continue;
    }

    // Single node, single task: discovery
    {
      const task_type = safeStr(list[0]?.type) || null;
      const task_input = list[0]?.input && typeof list[0].input === 'object' ? list[0].input : null;
      const eventType = 'discovery';
      events.push({
        type: eventType,
        topic,
        actors,
        context: { task_type, task_input },
        activity_phrase: deriveActivityPhrase({ task_type, task_input, topic }),
        outcome_phrase: deriveOutcomePhrase(eventType),
        collaboration_hint: deriveCollaborationHint({ eventType, actors }),
        novelty_hint: deriveNoveltyHint({ eventType, actorsCount: actors.length, failCount, maxSameKey, okCount }),
        summary: `${actors[0] || '1 agent'} recorded a new finding on ${topic}`
      });
    }
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
