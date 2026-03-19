import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
    ledger: path.join(dir, 'reputation_ledger.jsonl'),
    index: path.join(dir, 'reputation_index.json')
  };
}

function safeReadJson(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(String(raw || ''));
  } catch {
    return null;
  }
}

function atomicWriteJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
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

function normalizeEvent(e) {
  if (!isPlainObject(e)) return { ok: false, error: { code: 'INVALID_EVENT' } };

  const super_identity_id = String(e.super_identity_id || '').trim();
  if (!super_identity_id.startsWith('sid-')) return { ok: false, error: { code: 'INVALID_SUPER_ID' } };

  const event_type = String(e.event_type || '').trim();
  const allowed = new Set(['task_success', 'task_failure', 'peer_ack', 'peer_flag', 'manual_feedback']);
  if (!allowed.has(event_type)) return { ok: false, error: { code: 'INVALID_EVENT_TYPE' } };

  const source = isPlainObject(e.source) ? e.source : { type: 'system' };
  const sourceType = String(source.type || '').trim();
  if (!['peer', 'self', 'system'].includes(sourceType)) return { ok: false, error: { code: 'INVALID_SOURCE_TYPE' } };

  const peerSid = sourceType === 'peer' ? String(source.super_identity_id || '').trim() : null;
  if (sourceType === 'peer' && !peerSid.startsWith('sid-')) return { ok: false, error: { code: 'INVALID_PEER_SOURCE_SUPER_ID' } };

  const context = isPlainObject(e.context) ? e.context : {};

  // value is accepted but will be normalized by scoring rules.
  return {
    ok: true,
    event: {
      event_id: typeof e.event_id === 'string' && e.event_id.trim() ? e.event_id.trim() : evtId(),
      ts: typeof e.ts === 'string' && e.ts.trim() ? e.ts.trim() : nowIso(),
      super_identity_id,
      event_type,
      value: typeof e.value === 'number' ? e.value : 0,
      source: {
        type: sourceType,
        ...(sourceType === 'peer' ? { super_identity_id: peerSid } : {})
      },
      context: {
        task: typeof context.task === 'string' ? context.task : null,
        peer_node_id: typeof context.peer_node_id === 'string' ? context.peer_node_id : null,
        channel: typeof context.channel === 'string' ? context.channel : null,
        meta: isPlainObject(context.meta) ? context.meta : {}
      }
    }
  };
}

function baseWeight(event_type) {
  if (event_type === 'task_success') return 1;
  if (event_type === 'task_failure') return -1;
  if (event_type === 'peer_ack') return 1;
  if (event_type === 'peer_flag') return -2;
  if (event_type === 'manual_feedback') return 0;
  return 0;
}

function effectiveDelta(ev) {
  const w = baseWeight(ev.event_type);

  // Guard: self-spam prevention — self events do not change score by default.
  if (ev.source?.type === 'self') return 0;

  // System + peer events use base weights only (no silent weighting).
  return w;
}

function loadIndex(indexPath) {
  const j = safeReadJson(indexPath);
  if (j && isPlainObject(j) && isPlainObject(j.index)) return j;
  return { ok: true, updated_at: null, index: {} };
}

function saveIndex(indexPath, indexObj) {
  atomicWriteJson(indexPath, { ok: true, updated_at: nowIso(), index: indexObj });
}

function ensureSidEntry(idx, sid) {
  if (!idx[sid]) {
    idx[sid] = {
      score: 0,
      events: 0,
      last_updated: null,
      breakdown: {
        task_success: 0,
        task_failure: 0,
        peer_ack: 0,
        peer_flag: 0,
        manual_feedback: 0
      }
    };
  }
  if (!idx[sid].breakdown) idx[sid].breakdown = {};
  return idx[sid];
}

function tailLines(filePath, maxLines = 500) {
  try {
    const buf = fs.readFileSync(filePath);
    const s = buf.toString('utf8');
    const lines = s.split('\n').filter(Boolean);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

function isRateLimited({ ledgerPath, targetSid, sourceKey, hourIso, maxPerHour } = {}) {
  const lines = tailLines(ledgerPath, 800);
  let c = 0;
  for (const line of lines) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e?.super_identity_id !== targetSid) continue;

    const h = hourBucket(e?.ts);
    if (h !== hourIso) continue;

    const st = e?.source?.type;
    const sk = st === 'peer' ? `peer:${e?.source?.super_identity_id}` : st === 'system' ? 'system' : 'self';
    if (sk !== sourceKey) continue;

    const delta = baseWeight(e?.event_type);
    // Only cap positive events (prevents Sybil amplification via spam).
    if (delta > 0) c++;
    if (c >= maxPerHour) return true;
  }
  return false;
}

/**
 * emitReputationEvent(event)
 * - append-only ledger
 * - updates materialized index
 * - minimal Sybil resistance: per-source positive cap per hour
 */
export function emitReputationEvent(event, { dataDir } = {}) {
  const { ledger: ledgerPath, index: indexPath } = getPaths({ dataDir });

  const norm = normalizeEvent(event);
  if (!norm.ok) return norm;
  const ev = norm.event;

  const delta = effectiveDelta(ev);

  // Rate limit: max +5 per hour per source (peer/system). Self has zero delta anyway.
  const hourIso = hourBucket(ev.ts);
  const sourceKey = ev.source.type === 'peer' ? `peer:${ev.source.super_identity_id}` : ev.source.type;
  const maxPerHour = 5;
  if (delta > 0 && isRateLimited({ ledgerPath, targetSid: ev.super_identity_id, sourceKey, hourIso, maxPerHour })) {
    return { ok: false, error: { code: 'RATE_LIMITED', reason: 'max_positive_events_per_hour_per_source' } };
  }

  // Append ledger first (audit is primary source of truth).
  appendJsonlLine(ledgerPath, { ...ev, value: delta });

  // Update index.
  const doc = loadIndex(indexPath);
  const idx = isPlainObject(doc.index) ? doc.index : {};
  const entry = ensureSidEntry(idx, ev.super_identity_id);

  entry.score = Number(entry.score || 0) + delta;
  entry.events = Number(entry.events || 0) + 1;
  entry.last_updated = nowIso();
  entry.breakdown[ev.event_type] = Number(entry.breakdown[ev.event_type] || 0) + 1;

  saveIndex(indexPath, idx);

  return { ok: true, event: { ...ev, value: delta }, applied_delta: delta };
}

export function getReputation(super_identity_id, { dataDir } = {}) {
  const { index: indexPath } = getPaths({ dataDir });
  const doc = loadIndex(indexPath);
  const idx = isPlainObject(doc.index) ? doc.index : {};
  const sid = String(super_identity_id || '').trim();
  return { ok: true, super_identity_id: sid, reputation: idx[sid] || null };
}

export function getReputationBreakdown(super_identity_id, { dataDir } = {}) {
  const r = getReputation(super_identity_id, { dataDir });
  return { ok: true, super_identity_id: r.super_identity_id, breakdown: r.reputation?.breakdown || null };
}

export function rebuildReputationIndex({ dataDir } = {}) {
  const { ledger: ledgerPath, index: indexPath } = getPaths({ dataDir });

  const idx = {};
  const lines = tailLines(ledgerPath, 1000000); // acceptable for MV; ledger is expected to be small initially

  for (const line of lines) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const sid = String(ev?.super_identity_id || '').trim();
    if (!sid.startsWith('sid-')) continue;

    const entry = ensureSidEntry(idx, sid);
    const delta = typeof ev?.value === 'number' ? ev.value : 0;

    entry.score = Number(entry.score || 0) + delta;
    entry.events = Number(entry.events || 0) + 1;
    entry.last_updated = nowIso();
    const t = String(ev?.event_type || '');
    if (entry.breakdown[t] !== undefined) entry.breakdown[t] = Number(entry.breakdown[t] || 0) + 1;
  }

  saveIndex(indexPath, idx);
  return { ok: true, rebuilt: true, sids: Object.keys(idx).length };
}
