import fs from 'node:fs';
import path from 'node:path';

function num(x, dflt) {
  const n = Number(x);
  return Number.isFinite(n) ? n : dflt;
}

function clamp(x, lo, hi) {
  const n = Number(x);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function nowIso() {
  return new Date().toISOString();
}

let inflight = 0;

// test-only helper
export function __resetMarketForTests({ dataDir } = {}) {
  inflight = 0;
  if (dataDir) {
    try {
      fs.rmSync(getStatePath({ dataDir }), { force: true });
    } catch {}
  }
}

export function getLoadState() {
  return { inflight };
}

export function withInflight(fn) {
  inflight++;
  const done = () => {
    inflight = Math.max(0, inflight - 1);
  };

  return Promise.resolve()
    .then(() => fn())
    .finally(done);
}

function getStatePath({ dataDir } = {}) {
  const dir = dataDir || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'data');
  return path.join(dir, 'market_state.json');
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

export function loadMarketState({ dataDir } = {}) {
  const p = getStatePath({ dataDir });
  const j = safeReadJson(p);
  if (j && typeof j === 'object') return { ok: true, state: j, path: p };
  return {
    ok: true,
    path: p,
    state: {
      current_threshold: 1,
      recent_accept_count: 0,
      recent_reject_count: 0,
      recent_value_earned: 0,
      last_accepted_at: null,
      last_updated: null
    }
  };
}

export function saveMarketState(state, { dataDir } = {}) {
  const p = getStatePath({ dataDir });
  atomicWriteJson(p, { ...state, last_updated: nowIso() });
  return { ok: true, path: p };
}

function loadEarningsAnalytics({ dataDir } = {}) {
  try {
    const dir = dataDir || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'data');
    const p = path.join(dir, 'earnings_analytics.json');
    const raw = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(String(raw || ''));
    return j?.analytics || null;
  } catch {
    return null;
  }
}

function loadStrategyParams({ dataDir } = {}) {
  try {
    const dir = dataDir || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'data');
    const p = path.join(dir, 'strategy_state.json');
    const raw = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(String(raw || ''));
    return j?.current_params || null;
  } catch {
    return null;
  }
}

function preferenceWeightFromBreakdown(map, key) {
  if (!map || typeof map !== 'object') return 1.0;
  const entries = Object.entries(map).filter(([, v]) => Number.isFinite(Number(v)) && Number(v) > 0);
  if (entries.length === 0) return 1.0;

  const total = entries.reduce((a, [, v]) => a + Number(v), 0);
  if (total <= 0) return 1.0;

  const n = entries.length;
  const baseline = 1 / n;

  const v = Number(map[key] || 0);
  const share = v / total;

  // ratio above/below baseline; map into 0.8..1.2 range
  const ratio = baseline > 0 ? share / baseline : 1;
  const w = 1 + 0.2 * (ratio - 1);
  return clamp(w, 0.8, 1.2);
}

export function computeCurrentThreshold({ base_threshold, inflight, reputation_score, last_accepted_at, earnings_trend, strategy_params } = {}) {
  const base = num(base_threshold, 1);

  let overload_penalty = 0;
  if (inflight >= 5) overload_penalty = 2;
  else if (inflight >= 3) overload_penalty = 1;

  const rep = num(reputation_score, 0);
  const reputation_bonus = rep > 5 ? 1 : 0;

  // idle discount if no accept for long enough
  let idle_discount = 0;
  const t = Date.parse(String(last_accepted_at || ''));
  if (!Number.isFinite(t)) {
    idle_discount = 0.5;
  } else {
    const ageMs = Date.now() - t;
    if (ageMs >= 10 * 60_000) idle_discount = 0.5; // 10 min
  }

  // Earnings-aware threshold feedback (simple, explainable)
  const last24h = Number(earnings_trend?.reward_last_24h);
  const prev24h = Number(earnings_trend?.reward_prev_24h);
  const deltaUp = Number(process.env.A2A_STRATEGY_DELTA_UP ?? 0.2);
  const deltaDown = Number(process.env.A2A_STRATEGY_DELTA_DOWN ?? -0.2);

  let threshold_adjustment = 0;
  if (Number.isFinite(last24h) && Number.isFinite(prev24h)) {
    if (last24h > prev24h) threshold_adjustment = Number.isFinite(deltaUp) ? deltaUp : 0.2;
    else if (last24h < prev24h) threshold_adjustment = Number.isFinite(deltaDown) ? deltaDown : -0.2;
  }

  const local_threshold_adjustment = clamp(Number(strategy_params?.threshold_adjustment ?? 0), -1.0, 1.0);

  const raw = base + overload_penalty + reputation_bonus - idle_discount + threshold_adjustment + local_threshold_adjustment;
  return {
    base_threshold: base,
    overload_penalty,
    reputation_bonus,
    idle_discount,
    threshold_adjustment,
    local_threshold_adjustment,
    unclamped: raw,
    current_threshold: clamp(raw, 0.5, 5)
  };
}

/**
 * Adaptive pricing / dynamic thresholding (v0.4.1)
 *
 * Accept if:
 * - expected_value >= current_threshold
 * - AND not overloaded (hard gate: inflight < A2A_MAX_INFLIGHT)
 */
export function computeStrategyEffectiveExpectedValue({ expected_value, task_type, channel, node_super_identity_id }, { dataDir } = {}) {
  const ev = num(expected_value, 1);
  const mySid = typeof node_super_identity_id === 'string' && node_super_identity_id.startsWith('sid-') ? node_super_identity_id : null;
  const earningsAll = loadEarningsAnalytics({ dataDir });
  const myAnalytics = mySid && earningsAll ? earningsAll[mySid] : null;

  const tKey = typeof task_type === 'string' && task_type.trim() ? task_type.trim() : 'unknown';
  const cKey = typeof channel === 'string' && channel.trim() ? channel.trim() : 'unknown';

  const strategy_params = loadStrategyParams({ dataDir });
  const baseTask = preferenceWeightFromBreakdown(myAnalytics?.reward_by_task_type, tKey);
  const baseChan = preferenceWeightFromBreakdown(myAnalytics?.reward_by_channel, cKey);

  const localTask = clamp(Number(strategy_params?.task_weights?.[tKey] ?? 1.0), 0.8, 1.2);
  const localChan = clamp(Number(strategy_params?.channel_weights?.[cKey] ?? 1.0), 0.8, 1.2);

  const wTask = clamp(baseTask * localTask, 0.8, 1.2);
  const wChan = clamp(baseChan * localChan, 0.8, 1.2);

  return {
    ok: true,
    original_expected_value: ev,
    effective_expected_value: ev * wTask * wChan,
    preference_weight_task: wTask,
    preference_weight_channel: wChan,
    task_type: tKey,
    channel: cKey
  };
}

export function shouldAcceptTask({ expected_value, reputation_score, task_type, channel, node_super_identity_id }, { node_id, dataDir } = {}) {
  const maxInflight = num(process.env.A2A_MAX_INFLIGHT, 3);

  const ev = num(expected_value, 1);
  const rep = num(reputation_score, 0);

  const loaded = loadMarketState({ dataDir });
  const st = loaded.state;

  const mySid = typeof node_super_identity_id === 'string' && node_super_identity_id.startsWith('sid-') ? node_super_identity_id : null;
  const earningsAll = loadEarningsAnalytics({ dataDir });
  const myAnalytics = mySid && earningsAll ? earningsAll[mySid] : null;
  const strategy_params = loadStrategyParams({ dataDir });

  const formula = computeCurrentThreshold({
    base_threshold: num(process.env.A2A_BASE_THRESHOLD, 1),
    inflight,
    reputation_score: rep,
    last_accepted_at: st.last_accepted_at,
    earnings_trend: myAnalytics?.trend || null,
    strategy_params
  });

  const tKey = typeof task_type === 'string' && task_type.trim() ? task_type.trim() : 'unknown';
  const cKey = typeof channel === 'string' && channel.trim() ? channel.trim() : 'unknown';

  const base_task = preferenceWeightFromBreakdown(myAnalytics?.reward_by_task_type, tKey);
  const base_channel = preferenceWeightFromBreakdown(myAnalytics?.reward_by_channel, cKey);

  const local_task = clamp(Number(strategy_params?.task_weights?.[tKey] ?? 1.0), 0.8, 1.2);
  const local_channel = clamp(Number(strategy_params?.channel_weights?.[cKey] ?? 1.0), 0.8, 1.2);

  const preference_weight_task = clamp(base_task * local_task, 0.8, 1.2);
  const preference_weight_channel = clamp(base_channel * local_channel, 0.8, 1.2);

  const effective_expected_value = ev * preference_weight_task * preference_weight_channel;

  // strategy observability
  try {
    const topTask = myAnalytics ? Object.entries(myAnalytics.reward_by_task_type || {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null : null;
    const topChannel = myAnalytics ? Object.entries(myAnalytics.reward_by_channel || {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null : null;
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        event: 'STRATEGY_STATE',
        ts: nowIso(),
        node_id: node_id || null,
        node_super_identity_id: mySid,
        threshold_adjustment: formula.threshold_adjustment,
        top_task_type: topTask,
        top_channel: topChannel
      })}\n`
    );
  } catch {}

  // smooth changes to avoid oscillation
  const prevTh = num(st.current_threshold, 1);
  // smoothing to avoid oscillation; converge faster when idle (so idle nodes can win work)
  const alpha = formula.idle_discount > 0 ? 0.6 : 0.2;
  const smoothed = clamp(prevTh * (1 - alpha) + formula.current_threshold * alpha, 0.5, 5);

  const hardOverloaded = inflight >= maxInflight;

  let accepted = false;
  let reason = 'ok';
  if (hardOverloaded) {
    accepted = false;
    reason = 'overloaded';
    st.recent_reject_count = num(st.recent_reject_count, 0) + 1;
  } else if (effective_expected_value < smoothed) {
    accepted = false;
    reason = 'low_value';
    st.recent_reject_count = num(st.recent_reject_count, 0) + 1;
  } else {
    accepted = true;
    reason = 'ok';
    st.recent_accept_count = num(st.recent_accept_count, 0) + 1;
    st.last_accepted_at = nowIso();
    st.recent_value_earned = num(st.recent_value_earned, 0) + ev;
  }

  st.current_threshold = smoothed;
  saveMarketState(st, { dataDir });

  // observability
  try {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        event: 'MARKET_STATE_UPDATED',
        ts: nowIso(),
        node_id: node_id || null,
        current_threshold: smoothed,
        inflight,
        reputation_score: rep,
        recent_accept_count: st.recent_accept_count,
        recent_reject_count: st.recent_reject_count,
        recent_value_earned: st.recent_value_earned
      })}\n`
    );
  } catch {}

  return {
    accepted,
    reason,
    detail: {
      node_id: node_id || null,
      original_expected_value: ev,
      effective_expected_value,
      preference_weight_task,
      preference_weight_channel,
      task_type: tKey,
      channel: cKey,
      expected_value: ev,
      current_threshold: smoothed,
      inflight,
      maxInflight,
      reputation_score: rep,
      formula
    }
  };
}
