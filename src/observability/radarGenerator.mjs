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

function storyFromEvent(ev) {
  const type = safeStr(ev?.type);
  const topic = safeStr(ev?.topic) || 'unknown';
  const actors = uniq(ev?.actors);
  const n = actors.length || 1;

  if (type === 'confirmation') {
    return `${n} agents confirmed ${topic}`;
  }
  if (type === 'investigation') {
    return `${n} agents investigated ${topic}`;
  }
  if (type === 'anomaly') {
    return `${n} agents reported anomalies related to ${topic}`;
  }
  if (type === 'discovery') {
    const actor = actors[0] || '1 agent';
    return `${actor} discovered a new finding related to ${topic}`;
  }

  // fallback (machine-safe, still readable)
  return `${n} agents reported ${type || 'activity'} related to ${topic}`;
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

  const stories = events
    .map((ev) => ({
      type: safeStr(ev?.type) || null,
      topic: safeStr(ev?.topic) || null,
      actors: uniq(ev?.actors),
      story: storyFromEvent(ev)
    }))
    .filter((x) => safeStr(x.story));

  // stable sort: topic then type
  stories.sort((a, b) => {
    const ta = safeStr(a.topic);
    const tb = safeStr(b.topic);
    if (ta !== tb) return ta.localeCompare(tb);
    return safeStr(a.type).localeCompare(safeStr(b.type));
  });

  return {
    ok: true,
    kind: 'RADAR_V0_1',
    date: utcDateKey(),
    window: safeStr(agg.window) || null,
    stories
  };
}
