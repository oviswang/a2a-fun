import fs from 'node:fs';
import path from 'node:path';

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
    rewardLedger: path.join(dir, 'reward_ledger.jsonl'),
    valueLedger: path.join(dir, 'value_ledger.jsonl'),
    offerFeed: path.join(dir, 'offer_feed.jsonl'),
    out: path.join(dir, 'earnings_analytics.json')
  };
}

function atomicWriteJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

function readJsonlTail(p, maxLines = 200000) {
  try {
    const s = fs.readFileSync(p, 'utf8');
    const lines = s.split('\n').filter(Boolean);
    return lines.slice(-maxLines).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function addMapCount(map, key, delta) {
  map[key] = (map[key] || 0) + delta;
}

function addMapSum(map, key, delta) {
  map[key] = (map[key] || 0) + delta;
}

function parseTs(iso) {
  const t = Date.parse(String(iso || ''));
  return Number.isFinite(t) ? t : null;
}

function trendDirection(last24h, prev24h, eps = 0.01) {
  if (last24h > prev24h + eps) return 'up';
  if (last24h < prev24h - eps) return 'down';
  return 'flat';
}

export function rebuildEarningsAnalytics({ dataDir, nowMs } = {}) {
  const { rewardLedger, valueLedger, offerFeed, out } = getPaths({ dataDir });
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();

  const rewardEvents = readJsonlTail(rewardLedger, 200000).filter((e) => e.event_type === 'reward_credit');
  const valueEvents = readJsonlTail(valueLedger, 200000);
  const offerEvents = readJsonlTail(offerFeed, 200000);

  const valueById = new Map();
  for (const v of valueEvents) {
    if (typeof v?.event_id === 'string') valueById.set(v.event_id, v);
  }

  const offerById = new Map();
  for (const e of offerEvents) {
    if (typeof e?.offer_id !== 'string') continue;
    // Use latest offer_created as canonical offer fields.
    if (e.event_type === 'offer_created') {
      offerById.set(e.offer_id, e);
    }
  }

  const analytics = {};

  for (const ev of rewardEvents) {
    const sid = String(ev.super_identity_id || '').trim();
    if (!sid.startsWith('sid-')) continue;

    if (!analytics[sid]) {
      analytics[sid] = {
        total_reward: 0,
        credited_events: 0,
        reward_by_task_type: {},
        reward_by_channel: {},
        reward_by_offer_type: {},
        avg_reward_per_task: 0,
        avg_expected_value_won: 0,
        trend: {
          reward_last_24h: 0,
          reward_prev_24h: 0,
          reward_last_7d: 0,
          recent_reward_velocity: 0,
          trend_direction: 'flat'
        },
        last_updated: null
      };
    }

    const a = analytics[sid];
    const amt = Number(ev.amount);
    if (!Number.isFinite(amt)) continue;

    a.total_reward += amt;
    a.credited_events += 1;

    const ctx = isPlainObject(ev.context) ? ev.context : {};
    const taskType = String(ctx.task_id || 'unknown');
    addMapSum(a.reward_by_task_type, taskType, amt);

    const channel = String(ctx?.metadata?.channel || 'unknown');
    addMapSum(a.reward_by_channel, channel, amt);

    // offer_type is optional; infer from offer metadata if present
    const offer_id = typeof ctx.offer_id === 'string' ? ctx.offer_id : null;
    if (offer_id) {
      const offer = offerById.get(offer_id);
      const offerType = String(offer?.task_type || taskType || 'unknown');
      addMapSum(a.reward_by_offer_type, offerType, amt);

      const evv = Number(offer?.expected_value);
      if (Number.isFinite(evv)) {
        a.avg_expected_value_won += evv;
      }
    }

    // Trend windows
    const t = parseTs(ev.ts);
    if (t !== null) {
      const d = now - t;
      const day = 24 * 3600_000;
      const week = 7 * day;
      if (d <= day) a.trend.reward_last_24h += amt;
      if (d > day && d <= 2 * day) a.trend.reward_prev_24h += amt;
      if (d <= week) a.trend.reward_last_7d += amt;
    }

    a.last_updated = nowIso();

    // Attach explainability fields via value_event_id (optional, not persisted per-event in analytics)
    const vid = typeof ctx.value_event_id === 'string' ? ctx.value_event_id : null;
    if (vid) {
      const v = valueById.get(vid);
      // no-op: we keep ledger explainability in inspect script; analytics stays lightweight
      void v;
    }
  }

  // finalize derived averages + trend direction
  for (const [sid, a] of Object.entries(analytics)) {
    a.avg_reward_per_task = a.credited_events > 0 ? a.total_reward / a.credited_events : 0;

    // avg_expected_value_won stored as sum above; convert to avg
    const n = a.credited_events;
    a.avg_expected_value_won = n > 0 ? a.avg_expected_value_won / n : 0;

    a.trend.recent_reward_velocity = a.trend.reward_last_24h / 24;
    a.trend.trend_direction = trendDirection(a.trend.reward_last_24h, a.trend.reward_prev_24h);
  }

  const outObj = { ok: true, updated_at: nowIso(), analytics };
  atomicWriteJson(out, outObj);
  return { ok: true, path: out, analytics: outObj };
}
