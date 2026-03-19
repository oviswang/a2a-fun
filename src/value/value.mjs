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

  // base rule
  let base = 1;

  // no self-reward
  if (source_sid === target_sid) base = 0;

  // reputation multiplier (lightweight)
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

  const ev = {
    event_id: evtId(),
    ts: t,
    super_identity_id: target_sid,
    event_type: 'task_success',
    value: final_value,
    context: {
      ...ctx,
      source_sid,
      target_sid,
      reputation_score: repScore,
      multiplier: mult,
      rate_limited
    }
  };

  appendJsonlLine(ledgerPath, ev);

  // update index
  const doc = loadIndex(indexPath);
  const idx = isPlainObject(doc.index) ? doc.index : {};
  const entry = ensureEntry(idx, target_sid);
  entry.total_value = Number(entry.total_value || 0) + Number(final_value || 0);
  entry.event_count = Number(entry.event_count || 0) + 1;
  entry.last_updated = nowIso();
  saveIndex(indexPath, idx);

  return { ok: true, event: ev };
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
