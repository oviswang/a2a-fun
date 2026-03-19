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
    feed: path.join(dir, 'offer_feed.jsonl'),
    metrics: path.join(dir, 'market_metrics.json')
  };
}

function appendJsonlLine(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(obj) + '\n', 'utf8');
}

function safeMetadata(meta) {
  if (!isPlainObject(meta)) return {};
  // prevent huge payloads
  let s = '';
  try {
    s = JSON.stringify(meta);
  } catch {
    return {};
  }
  if (s.length <= 2048) return meta;
  return { truncated: true, length: s.length };
}

export function appendOfferFeedEvent(
  {
    offer_id,
    event_type,
    task_type,
    expected_value,
    source_super_identity_id,
    target_node_id,
    target_super_identity_id,
    reason,
    metadata
  } = {},
  { dataDir } = {}
) {
  const { feed } = getPaths({ dataDir });
  const ev = {
    event_id: `evt-${crypto.randomUUID()}`,
    ts: nowIso(),
    offer_id: offer_id || null,
    event_type: event_type || null,
    task_type: task_type || null,
    expected_value: typeof expected_value === 'number' ? expected_value : null,
    source_super_identity_id: source_super_identity_id || null,
    target_node_id: target_node_id || null,
    target_super_identity_id: target_super_identity_id || null,
    reason: reason || null,
    metadata: safeMetadata(metadata)
  };

  try {
    appendJsonlLine(feed, ev);
    return { ok: true, event: ev };
  } catch (e) {
    return { ok: false, error: { code: 'FEED_WRITE_FAILED', reason: String(e?.message || 'write_failed') } };
  }
}

function safeReadLines(p, maxLines = 5000) {
  try {
    const s = fs.readFileSync(p, 'utf8');
    const lines = s.split('\n').filter(Boolean);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

function atomicWriteJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

export function rebuildMarketMetrics({ dataDir } = {}) {
  const { feed, metrics } = getPaths({ dataDir });
  const lines = safeReadLines(feed, 200000);

  const m = {
    ok: true,
    updated_at: nowIso(),
    total_offers: 0,
    accepted_offers: 0,
    rejected_offers: 0,
    expired_offers: 0,
    executed_offers: 0,
    accept_rate: 0,
    avg_expected_value: 0,
    avg_expected_value_accepted: 0,
    top_rejection_reasons: {},
    task_type_breakdown: {}
  };

  let evSum = 0;
  let evCount = 0;
  let evAcceptedSum = 0;
  let evAcceptedCount = 0;

  for (const line of lines) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }

    const et = e?.event_type;
    const task = String(e?.task_type || 'unknown');
    m.task_type_breakdown[task] = (m.task_type_breakdown[task] || 0) + 1;

    const v = Number(e?.expected_value);
    if (Number.isFinite(v)) {
      evSum += v;
      evCount++;
    }

    if (et === 'offer_created') m.total_offers++;
    if (et === 'offer_accepted') {
      m.accepted_offers++;
      if (Number.isFinite(v)) {
        evAcceptedSum += v;
        evAcceptedCount++;
      }
    }
    if (et === 'offer_rejected') {
      m.rejected_offers++;
      const r = String(e?.reason || 'unknown');
      m.top_rejection_reasons[r] = (m.top_rejection_reasons[r] || 0) + 1;
    }
    if (et === 'offer_expired') m.expired_offers++;
    if (et === 'offer_executed') m.executed_offers++;
  }

  m.accept_rate = m.total_offers > 0 ? m.accepted_offers / m.total_offers : 0;
  m.avg_expected_value = evCount > 0 ? evSum / evCount : 0;
  m.avg_expected_value_accepted = evAcceptedCount > 0 ? evAcceptedSum / evAcceptedCount : 0;

  atomicWriteJson(metrics, m);
  return { ok: true, metrics: m, path: metrics };
}
