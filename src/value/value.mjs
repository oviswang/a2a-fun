import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { getReputation } from '../reputation/reputation.mjs';

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function getPaths({ dataDir } = {}) {
  const dir = dataDir || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'data');
  return {
    dataDir: dir,
    ledger: path.join(dir, 'value_ledger.jsonl'),
    index: path.join(dir, 'value_index.json')
  };
}

function atomicWriteJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

function safeReadJson(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(String(raw || ''));
  } catch {
    return null;
  }
}

function appendJsonlLine(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(obj) + '\n', 'utf8');
}

function evtId() {
  return `evt-${crypto.randomUUID()}`;
}

function hourBucket(isoTs) {
  const d = new Date(String(isoTs || nowIso()));
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

function tailLines(filePath, maxLines = 800) {
  try {
    const buf = fs.readFileSync(filePath);
    const s = buf.toString('utf8');
    const lines = s.split('\n').filter(Boolean);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

function logEvent(obj) {
  try {
    process.stdout.write(`${JSON.stringify(obj)}\n`);
  } catch {}
}

function findExistingValueEvent({ ledgerPath, offer_id, target_sid } = {}) {
  const oid = typeof offer_id === 'string' && offer_id.trim() ? offer_id.trim() : null;
  const sid = typeof target_sid === 'string' && target_sid.trim() ? target_sid.trim() : null;
  if (!oid || !sid) return null;

  const lines = tailLines(ledgerPath, 2000);
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try {
      e = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (e?.event_type !== 'task_success') continue;
    if (String(e?.super_identity_id || '') !== sid) continue;
    const ctx = e?.context || {};
    if (String(ctx?.offer_id || '') === oid) return e;
  }
  return null;
}

function loadIndex(indexPath) {
  const j = safeReadJson(indexPath);
  if (j && isPlainObject(j) && isPlainObject(j.index)) return j;
  return { ok: true, updated_at: null, index: {} };
}

function saveIndex(indexPath, indexObj) {
  atomicWriteJson(indexPath, { ok: true, updated_at: nowIso(), index: indexObj });
}

function ensureEntry(idx, sid) {
  if (!idx[sid]) {
    idx[sid] = { total_value: 0, event_count: 0, last_updated: null };
  }
  return idx[sid];
}

function reputationMultiplier(repScore) {
  const s = Number(repScore);
  if (!Number.isFinite(s)) return 1.0;
  if (s > 5) return 1.2;
  if (s < -5) return 0.8;
  return 1.0;
}

function sumValueForSourceHour({ ledgerPath, source_sid, hourIso } = {}) {
  const lines = tailLines(ledgerPath, 1200);
  let sum = 0;
  for (const line of lines) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (String(e?.context?.source_sid || '') !== String(source_sid || '')) continue;
    if (hourBucket(e?.ts) !== hourIso) continue;
    const v = Number(e?.value);
    if (Number.isFinite(v)) sum += v;
  }
  return sum;
}

/**
 * Emit a value event ONLY for real task_success.
 *
 * Anti-gaming:
 * - self-reward blocked (source_sid === target_sid -> value=0)
 * - per source_sid per hour cap total value = 10
 */
export function emitValueForTaskSuccess({
  super_identity_id,
  ts,
  context,
  dataDir
} = {}) {
  const sid = String(super_identity_id || '').trim();
  if (!sid.startsWith('sid-')) return { ok: false, error: { code: 'INVALID_SUPER_ID' } };

  const { ledger: ledgerPath, index: indexPath } = getPaths({ dataDir });

  const ctx = isPlainObject(context) ? context : {};
  const source_sid = String(ctx.source_sid || 'system');
  const target_sid = sid;
  let offer_id = typeof ctx.offer_id === 'string' && ctx.offer_id.trim() ? ctx.offer_id.trim() : null;

  // Forward trace completeness (v0.6.9): ensure required trace keys exist on write.
  // Never block value emission (no economic behavior change), but never be silent.
  const missingTraceKeys = [];
  if (!offer_id) missingTraceKeys.push('offer_id');
  const task_id = typeof ctx.task_id === 'string' && ctx.task_id.trim() ? ctx.task_id.trim() : (typeof ctx.task_type === 'string' ? String(ctx.task_type) : null);
  if (!task_id) missingTraceKeys.push('task_id');
  const winner_super_identity_id = typeof ctx.winner_sid === 'string' && ctx.winner_sid.trim() ? ctx.winner_sid.trim() : (typeof ctx.source_super_identity_id === 'string' && ctx.source_super_identity_id.trim() ? ctx.source_super_identity_id.trim() : null);
  if (!winner_super_identity_id) missingTraceKeys.push('winner_super_identity_id');
  const source_super_identity_id = typeof ctx.source_super_identity_id === 'string' && ctx.source_super_identity_id.trim() ? ctx.source_super_identity_id.trim() : null;
  if (!source_super_identity_id) missingTraceKeys.push('source_super_identity_id');

  if (!offer_id) {
    // Best-effort synthesized offer id for non-offer contexts. Marked via TRACE_KEY_MISSING_ON_WRITE.
    offer_id = `offer:local:${crypto.randomUUID()}`;
  }

  if (missingTraceKeys.length) {
    logEvent({
      ok: true,
      event: 'TRACE_KEY_MISSING_ON_WRITE',
      ts: nowIso(),
      stage: 'value_event',
      offer_id,
      task_id: task_id || null,
      winner_super_identity_id: winner_super_identity_id || null,
      source_super_identity_id: source_super_identity_id || null,
      missing: missingTraceKeys
    });
  }

  // Duplicate guard (integrity): avoid emitting multiple value events for the same offer_id+target_sid.
  // IMPORTANT: duplicates must be diagnosable, not silent.
  if (offer_id) {
    const existing = findExistingValueEvent({ ledgerPath, offer_id, target_sid });
    if (existing) {
      logEvent({
        ok: true,
        event: 'VALUE_EVENT_SKIPPED',
        ts: nowIso(),
        offer_id,
        task_id: typeof ctx.task_id === 'string' ? ctx.task_id : null,
        winner_sid: target_sid,
        source_super_identity_id: typeof ctx.source_super_identity_id === 'string' ? ctx.source_super_identity_id : null,
        amount: Number(existing?.value ?? 0),
        reason: 'duplicate_suppressed',
        stage: 'value',
        existing_value_event_id: existing?.event_id || null
      });
      return { ok: true, emitted: false, reason: 'duplicate_suppressed', existing_event: existing };
    }
  }

  // base rule: expected_value defaults to 1
  const expected_value = Number.isFinite(Number(ctx.expected_value)) ? Number(ctx.expected_value) : 1;
  let base = expected_value;

  // anti-gaming: no self-reward
  const self_reward_blocked = source_sid === target_sid;
  if (self_reward_blocked) base = 0;

  // reputation multiplier (lightweight; must not break value emission)
  const rep = getReputation(target_sid, { dataDir });
  const repScore = rep?.reputation?.score ?? 0;
  const mult = reputationMultiplier(repScore);

  let final_value = base * mult;

  // rate limit: per source_sid per hour max value = 10
  const t = typeof ts === 'string' && ts.trim() ? ts.trim() : nowIso();
  const hb = hourBucket(t);
  const used = sumValueForSourceHour({ ledgerPath, source_sid, hourIso: hb });
  const cap = 10;
  let rate_limited = false;
  if (final_value > 0 && used + final_value > cap) {
    final_value = 0;
    rate_limited = true;
  }

  const value_reason = self_reward_blocked
    ? 'zero_by_rule:self_reward_blocked'
    : rate_limited
      ? 'zero_by_rule:rate_limited'
      : Number(final_value) > 0
        ? 'positive_value'
        : 'zero_value';

  const ev = {
    event_id: evtId(),
    ts: t,
    super_identity_id: target_sid,
    event_type: 'task_success',
    value: final_value,
    context: {
      ...ctx,
      offer_id,
      task_id: task_id || null,
      winner_super_identity_id: winner_super_identity_id || null,
      source_super_identity_id: source_super_identity_id || null,
      expected_value,
      source_sid,
      target_sid,
      reputation_score: repScore,
      multiplier: mult,
      rate_limited,
      self_reward_blocked,
      value_reason
    }
  };

  try {
    appendJsonlLine(ledgerPath, ev);
  } catch (e) {
    logEvent({
      ok: false,
      event: 'VALUE_EVENT_FAILED',
      ts: nowIso(),
      offer_id,
      task_id: typeof ctx.task_id === 'string' ? ctx.task_id : null,
      winner_sid: target_sid,
      amount: Number(final_value || 0),
      reason: 'append_failed',
      stage: 'value',
      error: String(e?.message || e)
    });
    return { ok: false, error: { code: 'VALUE_APPEND_FAILED' } };
  }

  // update index
  try {
    const doc = loadIndex(indexPath);
    const idx = isPlainObject(doc.index) ? doc.index : {};
    const entry = ensureEntry(idx, target_sid);
    entry.total_value = Number(entry.total_value || 0) + Number(final_value || 0);
    entry.event_count = Number(entry.event_count || 0) + 1;
    entry.last_updated = nowIso();
    saveIndex(indexPath, idx);
  } catch (e) {
    // Index failure must be diagnosable but must not hide the value event.
    logEvent({
      ok: false,
      event: 'VALUE_EVENT_FAILED',
      ts: nowIso(),
      offer_id,
      task_id: typeof ctx.task_id === 'string' ? ctx.task_id : null,
      winner_sid: target_sid,
      amount: Number(final_value || 0),
      reason: 'index_update_failed',
      stage: 'value',
      value_event_id: ev.event_id,
      error: String(e?.message || e)
    });
  }

  logEvent({
    ok: true,
    event: 'VALUE_EVENT_EMITTED',
    ts: nowIso(),
    offer_id,
    task_id: typeof ctx.task_id === 'string' ? ctx.task_id : null,
    winner_sid: target_sid,
    source_super_identity_id: typeof ctx.source_super_identity_id === 'string' ? ctx.source_super_identity_id : null,
    expected_value,
    amount: Number(final_value || 0),
    multiplier: mult,
    reason: value_reason,
    stage: 'value',
    value_event_id: ev.event_id
  });

  return { ok: true, emitted: true, event: ev };
}

export function getValue(super_identity_id, { dataDir } = {}) {
  const { index: indexPath } = getPaths({ dataDir });
  const doc = loadIndex(indexPath);
  const idx = isPlainObject(doc.index) ? doc.index : {};
  const sid = String(super_identity_id || '').trim();
  return { ok: true, super_identity_id: sid, value: idx[sid] || null };
}

export function rebuildValueIndex({ dataDir } = {}) {
  const { ledger: ledgerPath, index: indexPath } = getPaths({ dataDir });
  const idx = {};

  const lines = tailLines(ledgerPath, 1_000_000);
  for (const line of lines) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const sid = String(ev?.super_identity_id || '').trim();
    if (!sid.startsWith('sid-')) continue;

    const entry = ensureEntry(idx, sid);
    const v = Number(ev?.value);
    entry.total_value = Number(entry.total_value || 0) + (Number.isFinite(v) ? v : 0);
    entry.event_count = Number(entry.event_count || 0) + 1;
    entry.last_updated = nowIso();
  }

  saveIndex(indexPath, idx);
  return { ok: true, rebuilt: true, sids: Object.keys(idx).length };
}
