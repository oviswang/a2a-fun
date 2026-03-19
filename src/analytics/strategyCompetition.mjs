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
    earnings: path.join(dir, 'earnings_analytics.json'),
    offerFeed: path.join(dir, 'offer_feed.jsonl'),
    rewardLedger: path.join(dir, 'reward_ledger.jsonl'),
    profiles: path.join(dir, 'strategy_profiles.json'),
    snapshot: path.join(dir, 'strategy_market_snapshot.json')
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

function readJsonlTail(p, maxLines = 200000) {
  try {
    const s = fs.readFileSync(p, 'utf8');
    const lines = s.split('\n').filter(Boolean);
    return lines.slice(-maxLines).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
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

function avg(arr) {
  if (!arr.length) return null;
  const s = arr.reduce((a, b) => a + b, 0);
  return s / arr.length;
}

function classifyStrategy(avg_threshold) {
  const conservative = Number(process.env.A2A_STRATEGY_CONSERVATIVE_TH ?? 2.5);
  const aggressive = Number(process.env.A2A_STRATEGY_AGGRESSIVE_TH ?? 1.2);
  const t = Number(avg_threshold);
  if (!Number.isFinite(t)) return 'balanced';
  if (t > conservative) return 'conservative';
  if (t < aggressive) return 'aggressive';
  return 'balanced';
}

function topKeys(map, n = 3) {
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map)
    .filter(([, v]) => Number.isFinite(Number(v)) && Number(v) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, n)
    .map(([k]) => k);
}

export function rebuildStrategyProfiles({ dataDir } = {}) {
  const { earnings, offerFeed, profiles, snapshot } = getPaths({ dataDir });

  const earnDoc = safeReadJson(earnings);
  const earn = earnDoc?.analytics || {};

  const feed = readJsonlTail(offerFeed, 200000);

  // Aggregate per target_super_identity_id (node sid)
  const agg = new Map();
  const ensure = (sid) => {
    if (!agg.has(sid)) {
      agg.set(sid, {
        sid,
        thresholds: [],
        wins: 0,
        losses: 0,
        attempts: 0,
        interests: 0
      });
    }
    return agg.get(sid);
  };

  for (const e of feed) {
    const sid = typeof e?.target_super_identity_id === 'string' ? e.target_super_identity_id : null;
    if (!sid || !sid.startsWith('sid-')) continue;

    const a = ensure(sid);

    if (e.event_type === 'offer_interest') a.interests++;
    if (e.event_type === 'offer_execution_attempt') a.attempts++;
    if (e.event_type === 'offer_execution_won') a.wins++;
    if (e.event_type === 'offer_execution_lost') a.losses++;

    if (e.event_type === 'offer_decision') {
      const th = Number(e?.metadata?.current_threshold);
      if (Number.isFinite(th)) a.thresholds.push(th);
    }
  }

  const outProfiles = [];

  for (const [sid, a] of agg.entries()) {
    const ea = earn[sid] || null;

    const avg_threshold = avg(a.thresholds);
    const strategy_type = classifyStrategy(avg_threshold);

    const total_reward = ea?.total_reward ?? 0;
    const credited_events = ea?.credited_events ?? 0;
    const avg_reward_per_task = credited_events > 0 ? total_reward / credited_events : 0;

    const wins = a.wins;
    const losses = a.losses;
    const win_rate = wins + losses > 0 ? wins / (wins + losses) : 0;

    const pickup_rate = a.interests > 0 ? a.attempts / a.interests : 0;

    const profile = {
      sid,
      strategy_type,
      avg_threshold,
      avg_reward_per_task,
      total_reward,
      win_rate,
      pickup_rate,
      task_focus: topKeys(ea?.reward_by_task_type, 3),
      channel_focus: topKeys(ea?.reward_by_channel, 3),
      last_updated: nowIso()
    };

    outProfiles.push(profile);

    try {
      process.stdout.write(`${JSON.stringify({ ok: true, event: 'STRATEGY_CLASSIFIED', ts: nowIso(), sid, strategy_type, avg_threshold })}\n`);
    } catch {}
  }

  const cache = { ok: true, updated_at: nowIso(), profiles: outProfiles };
  atomicWriteJson(profiles, cache);

  // Market snapshot aggregated by strategy_type
  const byType = new Map();
  const ensureType = (t) => {
    if (!byType.has(t)) {
      byType.set(t, { strategy_type: t, sids: 0, total_reward: 0, total_volume: 0, avg_reward_per_task: 0, avg_win_rate: 0, avg_threshold: 0 });
    }
    return byType.get(t);
  };

  for (const p of outProfiles) {
    const b = ensureType(p.strategy_type);
    b.sids++;
    b.total_reward += Number(p.total_reward || 0);
    b.total_volume += Number((earn[p.sid]?.credited_events) || 0);
    b.avg_reward_per_task += Number(p.avg_reward_per_task || 0);
    b.avg_win_rate += Number(p.win_rate || 0);
    b.avg_threshold += Number(p.avg_threshold || 0);
  }

  const snapshotObj = {
    ok: true,
    updated_at: nowIso(),
    by_strategy_type: [...byType.values()].map((x) => ({
      ...x,
      avg_reward_per_task: x.sids > 0 ? x.avg_reward_per_task / x.sids : 0,
      avg_win_rate: x.sids > 0 ? x.avg_win_rate / x.sids : 0,
      avg_threshold: x.sids > 0 ? x.avg_threshold / x.sids : null
    }))
  };

  atomicWriteJson(snapshot, snapshotObj);

  try {
    process.stdout.write(`${JSON.stringify({ ok: true, event: 'STRATEGY_PROFILE_UPDATED', ts: nowIso(), profiles: outProfiles.length })}\n`);
  } catch {}

  return { ok: true, profiles: cache, snapshot: snapshotObj, paths: { profiles, snapshot } };
}
