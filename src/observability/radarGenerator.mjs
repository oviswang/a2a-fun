import fs from 'node:fs/promises';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function uniq(arr) {
  return [...new Set((arr || []).map(safeStr).filter(Boolean))];
}

function utcDateKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

async function readJson(path) {
  const raw = await fs.readFile(path, 'utf8');
  return JSON.parse(raw);
}

function titleCase(s) {
  const x = safeStr(s);
  if (!x) return x;
  return x.replace(/_/g, ' ');
}

function describeTaskContext(ev) {
  const ctx = ev?.context && typeof ev.context === 'object' ? ev.context : {};
  const type = safeStr(ctx.task_type);
  const input = ctx.task_input && typeof ctx.task_input === 'object' ? ctx.task_input : null;

  const parts = [];
  if (type) parts.push(titleCase(type));

  if (input) {
    const check = safeStr(input.check);
    const question = safeStr(input.question);
    if (check) parts.push(`${titleCase(check)} checks`);
    else if (question) parts.push(`research: ${question}`);
  }

  return parts.length ? parts.join(' via ') : null;
}

function storyFromEvent(ev) {
  const type = safeStr(ev?.type);
  const topic = safeStr(ev?.topic) || 'unknown';
  const actors = uniq(ev?.actors);
  const n = actors.length || 1;
  const ctx = describeTaskContext(ev);
  const topicHuman = titleCase(topic);

  if (type === 'confirmation') {
    return ctx
      ? `${n} agents independently confirmed ${topicHuman} after multiple task executions (${ctx}).`
      : `${n} agents independently confirmed ${topicHuman} after multiple task executions.`;
  }
  if (type === 'investigation') {
    return ctx
      ? `${n} agents spent the day investigating ${topicHuman} (${ctx}).`
      : `${n} agents spent the day investigating ${topicHuman}.`;
  }
  if (type === 'anomaly') {
    return ctx
      ? `${n} agents reported unusual failures related to ${topicHuman} (${ctx}).`
      : `${n} agents reported unusual failures related to ${topicHuman}.`;
  }
  if (type === 'discovery') {
    const actor = actors[0] || '1 agent';
    return ctx
      ? `${actor} discovered a new observation while working on ${topicHuman} (${ctx}).`
      : `${actor} discovered a new observation while working on ${topicHuman}.`;
  }

  return ctx
    ? `${n} agents reported ${type || 'activity'} related to ${topicHuman} (${ctx}).`
    : `${n} agents reported ${type || 'activity'} related to ${topicHuman}.`;
}

function isTrivialTestString(s) {
  const x = safeStr(s).toLowerCase();
  if (!x) return false;
  return ['hi', 'hello', 'test', '123', 'ping', 'ok'].includes(x);
}

function isPlaceholderActor(a) {
  const x = safeStr(a);
  if (!x) return true;
  if (x.length < 2) return true;
  // common placeholders
  if (/^[A-Z]$/.test(x)) return true;
  if (['a', 'b', 'c', 'anon', 'unknown', 'n/a'].includes(x.toLowerCase())) return true;
  return false;
}

function isLowInfoStory(storyObj) {
  const topic = safeStr(storyObj?.topic);
  if (topic.length > 0 && topic.length < 3) return true;

  const actors = Array.isArray(storyObj?.actors) ? storyObj.actors : [];
  if (actors.length && actors.every(isPlaceholderActor)) return true;

  const ctx = storyObj?.context && typeof storyObj.context === 'object' ? storyObj.context : {};
  const input = ctx.task_input && typeof ctx.task_input === 'object' ? ctx.task_input : null;
  if (input) {
    const q = safeStr(input.question);
    if (q && isTrivialTestString(q)) return true;
  }

  const text = safeStr(storyObj?.story);
  if (text.length > 0 && text.length < 40) return true;

  return false;
}

export async function generateRadar({
  aggregate,
  aggregate_path
} = {}) {
  let agg = aggregate;
  if (!agg && aggregate_path) agg = await readJson(String(aggregate_path));

  if (!agg || typeof agg !== 'object') {
    return { ok: false, error: { code: 'MISSING_AGGREGATE' } };
  }
  if (safeStr(agg.kind) !== 'EXPERIENCE_AGGREGATE_V0_1') {
    return { ok: false, error: { code: 'INVALID_KIND', kind: agg.kind } };
  }

  const events = Array.isArray(agg.events) ? agg.events : [];

  const storiesAll = events
    .map((ev) => ({
      type: safeStr(ev?.type) || null,
      topic: safeStr(ev?.topic) || null,
      actors: uniq(ev?.actors),
      context: {
        task_type: safeStr(ev?.context?.task_type) || null,
        task_input: ev?.context?.task_input && typeof ev.context.task_input === 'object' ? ev.context.task_input : null
      },
      story: storyFromEvent(ev)
    }))
    .filter((x) => safeStr(x.story));

  const prio = { anomaly: 0, discovery: 1, confirmation: 2, investigation: 3 };

  // selection rules: prioritize anomaly -> discovery -> confirmation -> investigation, limit 5
  storiesAll.sort((a, b) => {
    const pa = prio[safeStr(a.type)] ?? 9;
    const pb = prio[safeStr(b.type)] ?? 9;
    if (pa !== pb) return pa - pb;
    const ta = safeStr(a.topic);
    const tb = safeStr(b.topic);
    if (ta !== tb) return ta.localeCompare(tb);
    return safeStr(a.story).localeCompare(safeStr(b.story));
  });

  // Content sanitizer v0.1: drop low-quality/test-like stories
  const stories = storiesAll.filter((s) => !isLowInfoStory(s)).slice(0, 5);

  return {
    ok: true,
    kind: 'RADAR_V0_1',
    date: utcDateKey(),
    window: safeStr(agg.window) || null,
    stories
  };
}
