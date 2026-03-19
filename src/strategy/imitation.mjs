import fs from 'node:fs';
import path from 'node:path';

function safeReadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function clamp(x, lo, hi) {
  const n = Number(x);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function getPaths({ dataDir } = {}) {
  const dir = dataDir || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'data');
  return {
    dataDir: dir,
    earnings: path.join(dir, 'earnings_analytics.json'),
    profiles: path.join(dir, 'strategy_profiles.json'),
    snapshot: path.join(dir, 'strategy_market_snapshot.json')
  };
}

function parseNum(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

export function findImitationCandidate(local_sid, { dataDir } = {}) {
  const sid = String(local_sid || '').trim();
  if (!sid.startsWith('sid-')) return { ok: false, reason: 'BAD_SID' };

  const { earnings, profiles, snapshot } = getPaths({ dataDir });
  const eDoc = safeReadJson(earnings);
  const pDoc = safeReadJson(profiles);
  const sDoc = safeReadJson(snapshot);

  const localE = eDoc?.analytics?.[sid] || null;
  const localP = pDoc?.profiles?.find?.((p) => p.sid === sid) || null;

  // Guard: require some data
  const credited = parseNum(localE?.credited_events, 0);
  if (credited < Number(process.env.A2A_IMITATION_MIN_CREDITS ?? 3)) {
    return { ok: false, reason: 'DATA_TOO_SPARSE' };
  }

  const last24 = parseNum(localE?.trend?.reward_last_24h, NaN);
  const prev24 = parseNum(localE?.trend?.reward_prev_24h, NaN);
  const under = Number.isFinite(last24) && Number.isFinite(prev24) ? last24 < prev24 : false;
  if (!under) return { ok: false, reason: 'NOT_UNDERPERFORMING' };

  const localAvgReward = parseNum(localP?.avg_reward_per_task, parseNum(localE?.total_reward, 0) / Math.max(1, credited));
  const localWin = parseNum(localP?.win_rate, 0);
  const localTh = parseNum(localP?.avg_threshold, NaN);

  // Candidate selection: pick best strategy_type from market snapshot
  const rows = Array.isArray(sDoc?.by_strategy_type) ? sDoc.by_strategy_type : [];
  if (rows.length === 0) return { ok: false, reason: 'NO_MARKET_SNAPSHOT' };

  const best = [...rows].sort((a, b) => (parseNum(b.avg_reward_per_task) - parseNum(a.avg_reward_per_task)) || (parseNum(b.avg_win_rate) - parseNum(a.avg_win_rate)))[0];
  const bestType = String(best?.strategy_type || '').trim();

  // Margin guard: must meaningfully outperform
  const marginReward = parseNum(best?.avg_reward_per_task, 0) - localAvgReward;
  const marginWin = parseNum(best?.avg_win_rate, 0) - localWin;
  const minMarginReward = parseNum(process.env.A2A_IMITATION_MIN_REWARD_MARGIN ?? 0.2, 0.2);
  const minMarginWin = parseNum(process.env.A2A_IMITATION_MIN_WIN_MARGIN ?? 0.05, 0.05);

  if (!(marginReward >= minMarginReward || marginWin >= minMarginWin)) {
    return { ok: false, reason: 'ADVANTAGE_TOO_SMALL', candidate_strategy_type: bestType };
  }

  // Suggest exactly ONE bounded adjustment
  const stepThreshold = 0.1;

  const bestTh = parseNum(best?.avg_threshold, NaN);
  if (Number.isFinite(bestTh) && Number.isFinite(localTh) && Math.abs(bestTh - localTh) >= 0.2) {
    const dir = bestTh > localTh ? +1 : -1;
    return {
      ok: true,
      candidate_strategy_type: bestType,
      suggested_adjustment: { kind: 'threshold_adjustment', delta: dir * stepThreshold },
      reason: `imitation: market ${bestType} outperforms local (Δreward=${marginReward.toFixed(2)}, Δwin=${marginWin.toFixed(2)})`
    };
  }

  // Fallback: gently nudge ONE weight toward candidate's typical focus (without copying maps)
  const targetTask = Array.isArray(localP?.task_focus) && localP.task_focus.length ? localP.task_focus[0] : null;
  const targetChannel = Array.isArray(localP?.channel_focus) && localP.channel_focus.length ? localP.channel_focus[0] : null;

  if (targetTask) {
    return {
      ok: true,
      candidate_strategy_type: bestType,
      suggested_adjustment: { kind: 'task_weight', key: targetTask, delta: +0.05 },
      reason: `imitation: reinforce task_focus=${targetTask} (bounded +0.05)`
    };
  }

  if (targetChannel) {
    return {
      ok: true,
      candidate_strategy_type: bestType,
      suggested_adjustment: { kind: 'channel_weight', key: targetChannel, delta: +0.05 },
      reason: `imitation: reinforce channel_focus=${targetChannel} (bounded +0.05)`
    };
  }

  return { ok: false, reason: 'NO_SAFE_SUGGESTION', candidate_strategy_type: bestType };
}

export function applyImitationSuggestionToParams(current_params, suggestion) {
  const cur = current_params || { threshold_adjustment: 0, task_weights: {}, channel_weights: {} };
  if (!suggestion || typeof suggestion !== 'object') return { ok: false, reason: 'BAD_SUGGESTION' };

  if (suggestion.kind === 'threshold_adjustment') {
    const next = clamp(parseNum(cur.threshold_adjustment, 0) + parseNum(suggestion.delta, 0), -1.0, 1.0);
    return { ok: true, next_params: { ...cur, threshold_adjustment: next } };
  }

  if (suggestion.kind === 'task_weight' && suggestion.key) {
    const k = String(suggestion.key);
    const curW = parseNum(cur.task_weights?.[k], 1.0);
    const nextW = clamp(curW + parseNum(suggestion.delta, 0), 0.8, 1.2);
    return { ok: true, next_params: { ...cur, task_weights: { ...(cur.task_weights || {}), [k]: nextW } } };
  }

  if (suggestion.kind === 'channel_weight' && suggestion.key) {
    const k = String(suggestion.key);
    const curW = parseNum(cur.channel_weights?.[k], 1.0);
    const nextW = clamp(curW + parseNum(suggestion.delta, 0), 0.8, 1.2);
    return { ok: true, next_params: { ...cur, channel_weights: { ...(cur.channel_weights || {}), [k]: nextW } } };
  }

  return { ok: false, reason: 'UNSUPPORTED_SUGGESTION' };
}
