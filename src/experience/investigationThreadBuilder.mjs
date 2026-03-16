import fs from 'node:fs/promises';
import crypto from 'node:crypto';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function uniq(arr) {
  return [...new Set((arr || []).map(safeStr).filter(Boolean))];
}

function hashId(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
}

async function readJson(path) {
  const raw = await fs.readFile(path, 'utf8');
  return JSON.parse(raw);
}

function sortEventsStable(a, b) {
  // v0.1: events usually lack timestamps. Use type/topic/summary to stabilize.
  const ta = safeStr(a?.topic);
  const tb = safeStr(b?.topic);
  if (ta !== tb) return ta.localeCompare(tb);
  const ea = safeStr(a?.type);
  const eb = safeStr(b?.type);
  if (ea !== eb) return ea.localeCompare(eb);
  return safeStr(a?.summary).localeCompare(safeStr(b?.summary));
}

function threadTypeForTopicEvents(list) {
  const types = new Set(list.map((e) => safeStr(e?.type)).filter(Boolean));
  if (types.has('anomaly')) return 'anomaly';
  if (types.has('confirmation')) return 'confirmation';
  if (types.has('investigation')) return 'investigation';
  if (types.has('discovery')) return 'discovery';
  return 'investigation';
}

function buildThreadSummary({ thread_type, topic, actors, event_count, hasDiscovery, hasConfirmation } = {}) {
  const n = Array.isArray(actors) ? actors.length : 0;
  const t = safeStr(topic) || 'unknown';
  const et = safeStr(thread_type) || 'investigation';

  if (et === 'anomaly') {
    return `${n} agents observed repeated anomalies on ${t} across ${event_count} events.`;
  }
  if (et === 'confirmation') {
    return `${n} agents converged on consistent results for ${t} across ${event_count} events.`;
  }
  if (hasDiscovery && hasConfirmation) {
    return `${n} agents took ${t} from discovery to confirmation (${event_count} events).`;
  }
  if (et === 'investigation') {
    return `${n} agents collaborated to investigate ${t} (${event_count} events).`;
  }
  return `${n} agents tracked ${t} (${event_count} events).`;
}

function openingPhrase({ first_actor, first_activity } = {}) {
  const a = safeStr(first_actor) || 'An agent';
  const act = safeStr(first_activity) || 'working';
  return `${a} started ${act} earlier today.`;
}

function spreadPhrase({ actors } = {}) {
  const list = Array.isArray(actors) ? actors : [];
  if (list.length < 2) return null;
  const others = list.length - 1;
  if (others === 1) return `One other agent later joined the same effort.`;
  return `${others} other agents later joined the same effort.`;
}

function resolutionPhrase({ thread_type } = {}) {
  const t = safeStr(thread_type);
  if (t === 'anomaly') return 'By the end of the day, repeated failures were being reported.';
  if (t === 'confirmation') return 'By the end of the day, the agents had converged on the same conclusion.';
  if (t === 'investigation') return 'The topic remained under active investigation.';
  if (t === 'discovery') return 'The new observation remained unconfirmed.';
  return 'The work continued.';
}

function buildNarrative({ opening_phrase, spread_phrase, resolution_phrase } = {}) {
  const parts = [safeStr(opening_phrase), safeStr(spread_phrase), safeStr(resolution_phrase)].filter(Boolean);
  return parts.join(' ');
}

export async function buildInvestigationThreads({ aggregate, aggregate_path, window = 'last_24h' } = {}) {
  let agg = aggregate;
  if (!agg && aggregate_path) agg = await readJson(String(aggregate_path));

  if (!agg || typeof agg !== 'object') return { ok: false, error: { code: 'MISSING_AGGREGATE' } };
  if (safeStr(agg.kind) !== 'EXPERIENCE_AGGREGATE_V0_1') return { ok: false, error: { code: 'INVALID_KIND', kind: agg.kind } };

  const events = Array.isArray(agg.events) ? agg.events : [];

  // Group by topic
  const byTopic = new Map();
  for (const e of events) {
    const topic = safeStr(e?.topic) || 'unknown';
    if (!byTopic.has(topic)) byTopic.set(topic, []);
    byTopic.get(topic).push(e);
  }

  const threads = [];

  for (const [topic, listRaw] of byTopic.entries()) {
    const list = [...listRaw].sort(sortEventsStable);
    const actors = uniq(list.flatMap((e) => e?.actors || []));
    const types = new Set(list.map((e) => safeStr(e?.type)).filter(Boolean));

    const hasDiscovery = types.has('discovery');
    const hasConfirmation = types.has('confirmation');
    const hasAnomaly = types.has('anomaly');

    const qualifies =
      actors.length >= 2 ||
      (hasDiscovery && hasConfirmation) ||
      (hasAnomaly && list.filter((e) => safeStr(e?.type) === 'anomaly').length >= 2);

    if (!qualifies) continue;

    const thread_type = threadTypeForTopicEvents(list);
    const thread_id = `thread:${hashId(`v0.1:${window}:${topic}:${thread_type}`)}`;

    const first_actor = actors[0] || null;
    const first_activity = safeStr(list[0]?.activity_phrase) || null;

    const opening_phrase = openingPhrase({ first_actor, first_activity });
    const spread_phrase = spreadPhrase({ actors });
    const resolution_phrase = resolutionPhrase({ thread_type });
    const narrative = buildNarrative({ opening_phrase, spread_phrase, resolution_phrase });

    threads.push({
      thread_id,
      topic,
      actors,
      event_count: list.length,
      thread_type,
      summary: buildThreadSummary({
        thread_type,
        topic,
        actors,
        event_count: list.length,
        hasDiscovery,
        hasConfirmation
      }),
      opening_phrase,
      spread_phrase,
      resolution_phrase,
      narrative
    });
  }

  // Stable sort threads by topic
  threads.sort((a, b) => safeStr(a.topic).localeCompare(safeStr(b.topic)));

  return {
    ok: true,
    kind: 'INVESTIGATION_THREADS_V0_1',
    window,
    threads
  };
}
