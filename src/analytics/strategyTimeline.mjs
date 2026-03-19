import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_META_BYTES = 2048;

function nowIso() {
  return new Date().toISOString();
}

function safeJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return '{}';
  }
}

function truncateString(s, maxBytes) {
  const str = String(s ?? '');
  const buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxBytes) return str;
  // crude truncation by bytes
  const truncated = buf.subarray(0, maxBytes - 3).toString('utf8');
  return truncated + '...';
}

function truncateEvent(event) {
  // Only truncate high-risk large strings (reason). Keep structure stable.
  const e = structuredClone(event);
  if (e?.adjustment?.reason) {
    e.adjustment.reason = truncateString(e.adjustment.reason, 1024);
  }
  if (e?.adjustment?.imitation_reference?.reason) {
    e.adjustment.imitation_reference.reason = truncateString(e.adjustment.imitation_reference.reason, 512);
  }
  // hard cap total line size
  let line = safeJson(e);
  if (Buffer.byteLength(line, 'utf8') <= MAX_META_BYTES) return e;

  // if still too large, drop optional fields (evaluation.before avg fields etc)
  if (e.before && typeof e.before === 'object') {
    e.before = {
      threshold_adjustment: e.before.threshold_adjustment ?? null,
      reward_last_24h: e.before.reward_last_24h ?? null,
      avg_reward_per_task: e.before.avg_reward_per_task ?? null
    };
  }
  if (e.after && typeof e.after === 'object') {
    e.after = { threshold_adjustment: e.after.threshold_adjustment ?? null };
  }
  if (e.evaluation && typeof e.evaluation === 'object') {
    e.evaluation = { baseline_reward_24h: e.evaluation.baseline_reward_24h ?? null };
  }

  line = safeJson(e);
  if (Buffer.byteLength(line, 'utf8') <= MAX_META_BYTES) return e;

  // last resort: replace reason with placeholder
  if (e?.adjustment) e.adjustment.reason = '[truncated]';
  return e;
}

function getTimelinePath({ dataDir } = {}) {
  const dir = dataDir || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'data');
  return { dataDir: dir, timeline: path.join(dir, 'strategy_timeline.jsonl') };
}

async function appendLine(filePath, obj) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, JSON.stringify(obj) + '\n', 'utf8');
}

export async function appendStrategyEvent({ super_identity_id, adjustment, before, after, evaluation, event_id } = {}, { dataDir } = {}) {
  const { timeline } = getTimelinePath({ dataDir });
  const eid = String(event_id || `evt-${crypto.randomUUID()}`);

  const event = truncateEvent({
    event_id: eid,
    ts: nowIso(),
    super_identity_id,
    event_type: 'strategy_adjustment',
    adjustment,
    before,
    after,
    evaluation
  });

  try {
    await appendLine(timeline, event);
    try {
      process.stdout.write(`${JSON.stringify({ ok: true, event: 'STRATEGY_TIMELINE_EVENT_WRITTEN', ts: nowIso(), super_identity_id, event_id: eid })}\n`);
    } catch {}
    return { ok: true, event_id: eid };
  } catch (err) {
    try {
      process.stderr.write(`WARN strategy_timeline append failed: ${String(err?.message || err)}\n`);
    } catch {}
    return { ok: false, event_id: eid };
  }
}

export async function appendStrategyEvaluation({ super_identity_id, linked_event_id, result, before_reward, after_reward, decision, event_id } = {}, { dataDir } = {}) {
  const { timeline } = getTimelinePath({ dataDir });
  const eid = String(event_id || `evt-${crypto.randomUUID()}`);

  const event = truncateEvent({
    event_id: eid,
    ts: nowIso(),
    super_identity_id,
    event_type: 'strategy_evaluation',
    linked_event_id,
    result,
    before_reward,
    after_reward,
    decision
  });

  try {
    await appendLine(timeline, event);
    try {
      process.stdout.write(`${JSON.stringify({ ok: true, event: 'STRATEGY_EVALUATION_RECORDED', ts: nowIso(), super_identity_id, event_id: eid, linked_event_id, result, decision })}\n`);
    } catch {}
    return { ok: true, event_id: eid };
  } catch (err) {
    try {
      process.stderr.write(`WARN strategy_timeline append failed: ${String(err?.message || err)}\n`);
    } catch {}
    return { ok: false, event_id: eid };
  }
}

export async function getStrategyTimeline({ sid, limit = 50 } = {}, { dataDir } = {}) {
  const { timeline } = getTimelinePath({ dataDir });
  try {
    const raw = await fs.readFile(timeline, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const events = [];
    for (let i = lines.length - 1; i >= 0 && events.length < limit; i--) {
      try {
        const e = JSON.parse(lines[i]);
        if (!sid || e.super_identity_id === sid) events.push(e);
      } catch {}
    }
    return { ok: true, sid, events: events.reverse() };
  } catch {
    return { ok: true, sid, events: [] };
  }
}

export async function getStrategyEffectiveness({ sid } = {}, { dataDir } = {}) {
  const tl = await getStrategyTimeline({ sid, limit: 5000 }, { dataDir });
  const evals = tl.events.filter((e) => e.event_type === 'strategy_evaluation');
  const total_adjustments = tl.events.filter((e) => e.event_type === 'strategy_adjustment').length;

  let improved = 0;
  let degraded = 0;
  let flat = 0;
  for (const e of evals) {
    if (e.result === 'improved') improved++;
    else if (e.result === 'degraded') degraded++;
    else flat++;
  }

  const total = improved + degraded + flat;
  const success_rate = total > 0 ? improved / total : 0;
  return { ok: true, sid, total_adjustments, improved, degraded, flat, success_rate };
}
