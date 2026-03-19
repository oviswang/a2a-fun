import fs from 'node:fs';
import path from 'node:path';

function nowIso(nowMs = Date.now()) {
  return new Date(nowMs).toISOString();
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
    state: path.join(dir, 'strategy_state.json'),
    earnings: path.join(dir, 'earnings_analytics.json'),
    profiles: path.join(dir, 'strategy_profiles.json'),
    snapshot: path.join(dir, 'strategy_market_snapshot.json')
  };
}

function safeReadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
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

export function loadStrategyState({ dataDir, autoInit = true } = {}) {
  const { state } = getPaths({ dataDir });
  const j = safeReadJson(state);
  if (j && typeof j === 'object') return j;
  const init = {
    ok: true,
    current_params: {
      threshold_adjustment: 0,
      task_weights: {},
      channel_weights: {}
    },
    last_adjustment_at: null,
    last_adjustment_reason: null,
    rollback_candidate: null,
    pending_evaluation: null
  };
  if (autoInit) {
    try { atomicWriteJson(state, init); } catch {}
  }
  return init;
}

export function saveStrategyState(next, { dataDir } = {}) {
  const { state } = getPaths({ dataDir });
  atomicWriteJson(state, { ok: true, ...next });
  return { ok: true, path: state };
}

function pickBestStrategyType(snapshot) {
  const rows = snapshot?.by_strategy_type;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  // best = highest avg_reward_per_task, tie-break by avg_win_rate
  return [...rows].sort((a, b) => (b.avg_reward_per_task - a.avg_reward_per_task) || (b.avg_win_rate - a.avg_win_rate))[0];
}

function getLocalEarnings(earningsDoc, sid) {
  const a = earningsDoc?.analytics?.[sid] || null;
  return a;
}

function computeLocalUnderperformance(localEarnings) {
  const last = Number(localEarnings?.trend?.reward_last_24h);
  const prev = Number(localEarnings?.trend?.reward_prev_24h);
  if (!Number.isFinite(last) || !Number.isFinite(prev)) return false;
  return last < prev;
}

function ensureMap(m) {
  return m && typeof m === 'object' ? m : {};
}

function bumpWeight(map, key, delta) {
  const cur = Number(map[key] ?? 1.0);
  const next = clamp(cur + delta, 0.8, 1.2);
  return { ...map, [key]: next };
}

export function evaluateAndEvolveStrategy({ sid, dataDir, nowMs } = {}) {
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const { earnings, profiles, snapshot } = getPaths({ dataDir });

  const st = loadStrategyState({ dataDir });

  const windowHours = Number(process.env.A2A_STRATEGY_EVAL_WINDOW_HOURS ?? 6);
  const windowMs = Number.isFinite(windowHours) ? windowHours * 3600 * 1000 : 6 * 3600 * 1000;

  // guard: no more than one adjustment per window
  if (st.last_adjustment_at) {
    const lastAt = Date.parse(st.last_adjustment_at);
    if (Number.isFinite(lastAt) && now - lastAt < windowMs) {
      return { ok: true, action: 'noop', reason: 'cooldown', state: st };
    }
  }

  const earningsDoc = safeReadJson(earnings);
  const localE = getLocalEarnings(earningsDoc, sid);
  if (!localE) return { ok: true, action: 'noop', reason: 'missing_local_earnings', state: st };

  // Rollback evaluation (explicit)
  if (st.pending_evaluation?.applied_at) {
    const appliedAt = Date.parse(st.pending_evaluation.applied_at);
    if (Number.isFinite(appliedAt) && now - appliedAt >= windowMs) {
      const baseline = Number(st.pending_evaluation.baseline_reward_last_24h);
      const current = Number(localE?.trend?.reward_last_24h);
      if (Number.isFinite(baseline) && Number.isFinite(current) && current < baseline * 0.9 && st.rollback_candidate?.previous_params) {
        const prev = st.rollback_candidate.previous_params;
        const rolled = {
          ...st,
          current_params: prev,
          last_adjustment_at: nowIso(now),
          last_adjustment_reason: 'rollback: performance worsened after evaluation window',
          pending_evaluation: null
        };
        saveStrategyState(rolled, { dataDir });
        try {
          process.stdout.write(
            `${JSON.stringify({
              ok: true,
              event: 'STRATEGY_ADJUSTMENT_ROLLED_BACK',
              ts: nowIso(now),
              sid,
              previous_params: st.current_params,
              restored_params: prev,
              baseline_reward_last_24h: baseline,
              current_reward_last_24h: current
            })}\n`
          );
        } catch {}
        return { ok: true, action: 'rollback', state: rolled };
      }

      // evaluation done but no rollback
      const cleared = { ...st, pending_evaluation: null };
      saveStrategyState(cleared, { dataDir });
      return { ok: true, action: 'evaluation_cleared', state: cleared };
    }
  }

  const snap = safeReadJson(snapshot);
  const best = pickBestStrategyType(snap);
  if (!best) return { ok: true, action: 'noop', reason: 'missing_market_snapshot', state: st };

  const localUnder = computeLocalUnderperformance(localE);
  if (!localUnder) return { ok: true, action: 'noop', reason: 'no_underperformance_signal', state: st };

  const stepThreshold = 0.1;
  const stepWeight = 0.05;

  const cur = st.current_params || { threshold_adjustment: 0, task_weights: {}, channel_weights: {} };

  // Proposal: nudge threshold_adjustment toward the best-performing strategy's avg_threshold
  let proposed = null;
  let reason = null;

  const bestAvgTh = Number(best.avg_threshold);
  const localAvgTh = Number(safeReadJson(profiles)?.profiles?.find?.((p) => p.sid === sid)?.avg_threshold);

  if (Number.isFinite(bestAvgTh) && Number.isFinite(localAvgTh)) {
    if (bestAvgTh > localAvgTh + 0.1) {
      proposed = { ...cur, threshold_adjustment: clamp(Number(cur.threshold_adjustment || 0) + stepThreshold, -1.0, 1.0) };
      reason = `underperformance + market favors higher-threshold strategies (${best.strategy_type})`;
    } else if (bestAvgTh < localAvgTh - 0.1) {
      proposed = { ...cur, threshold_adjustment: clamp(Number(cur.threshold_adjustment || 0) - stepThreshold, -1.0, 1.0) };
      reason = `underperformance + market favors lower-threshold strategies (${best.strategy_type})`;
    }
  }

  // If threshold not adjusted, consider task/channel micro-adjustments toward current top performers
  if (!proposed) {
    const byTask = ensureMap(localE.reward_by_task_type);
    const byChan = ensureMap(localE.reward_by_channel);

    const topTask = Object.entries(byTask).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] || null;
    const lowTask = Object.entries(byTask).sort((a, b) => Number(a[1]) - Number(b[1]))[0]?.[0] || null;

    const topChan = Object.entries(byChan).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] || null;
    const lowChan = Object.entries(byChan).sort((a, b) => Number(a[1]) - Number(b[1]))[0]?.[0] || null;

    if (topTask) {
      proposed = { ...cur, task_weights: bumpWeight(ensureMap(cur.task_weights), topTask, +stepWeight) };
      reason = `underperformance + reinforce top task_type=${topTask}`;
    } else if (topChan) {
      proposed = { ...cur, channel_weights: bumpWeight(ensureMap(cur.channel_weights), topChan, +stepWeight) };
      reason = `underperformance + reinforce top channel=${topChan}`;
    } else if (lowTask) {
      proposed = { ...cur, task_weights: bumpWeight(ensureMap(cur.task_weights), lowTask, -stepWeight) };
      reason = `underperformance + de-emphasize low task_type=${lowTask}`;
    } else if (lowChan) {
      proposed = { ...cur, channel_weights: bumpWeight(ensureMap(cur.channel_weights), lowChan, -stepWeight) };
      reason = `underperformance + de-emphasize low channel=${lowChan}`;
    }
  }

  if (!proposed || !reason) return { ok: true, action: 'noop', reason: 'no_safe_adjustment', state: st };

  try {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        event: 'STRATEGY_ADJUSTMENT_PROPOSED',
        ts: nowIso(now),
        sid,
        previous_params: cur,
        proposed_params: proposed,
        reason,
        metrics_used: {
          local_reward_last_24h: localE?.trend?.reward_last_24h ?? null,
          local_reward_prev_24h: localE?.trend?.reward_prev_24h ?? null,
          market_best_strategy_type: best?.strategy_type ?? null,
          market_best_avg_reward_per_task: best?.avg_reward_per_task ?? null,
          market_best_avg_threshold: best?.avg_threshold ?? null
        }
      })}\n`
    );
  } catch {}

  const next = {
    ...st,
    current_params: proposed,
    last_adjustment_at: nowIso(now),
    last_adjustment_reason: reason,
    rollback_candidate: { previous_params: cur },
    pending_evaluation: {
      applied_at: nowIso(now),
      baseline_reward_last_24h: Number(localE?.trend?.reward_last_24h ?? 0)
    }
  };

  saveStrategyState(next, { dataDir });

  try {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        event: 'STRATEGY_ADJUSTMENT_APPLIED',
        ts: nowIso(now),
        sid,
        previous_params: cur,
        new_params: proposed,
        reason
      })}\n`
    );
  } catch {}

  return { ok: true, action: 'applied', state: next };
}
