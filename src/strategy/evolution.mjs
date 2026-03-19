import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { appendStrategyEvent, appendStrategyEvaluation } from '../analytics/strategyTimeline.mjs';
import { findImitationCandidate, applyImitationSuggestionToParams } from './imitation.mjs';
import { appendImitationReference, appendImitationEvaluation } from '../analytics/learningNetwork.mjs';

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
    last_adjustment_source: null,
    imitation_reference: null,
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

        // best-effort timeline evaluation record
        try {
          const result = current > baseline * 1.1 ? 'improved' : current < baseline * 0.9 ? 'degraded' : 'flat';
          appendStrategyEvaluation(
            {
              super_identity_id: sid,
              linked_event_id: st.pending_evaluation?.linked_event_id || null,
              result,
              before_reward: baseline,
              after_reward: current,
              decision: 'rolled_back'
            },
            { dataDir }
          ).catch(() => {});

          if (st.last_adjustment_source === 'imitation_hint' || st.imitation_reference) {
            appendImitationEvaluation(
              {
                super_identity_id: sid,
                linked_event_id: st.pending_evaluation?.linked_event_id || null,
                result,
                before_reward: baseline,
                after_reward: current,
                decision: 'rolled_back',
                context: {
                  candidate_strategy_type: st.imitation_reference?.candidate_strategy_type || null,
                  candidate_reference_sid: null,
                  reward_delta: Number(current) - Number(baseline)
                }
              },
              { dataDir }
            ).catch(() => {});
          }
        } catch {}

        return { ok: true, action: 'rollback', state: rolled };
      }

      // evaluation done but no rollback
      const cleared = { ...st, pending_evaluation: null };
      saveStrategyState(cleared, { dataDir });

      // best-effort timeline evaluation record
      try {
        const result = current > baseline * 1.1 ? 'improved' : current < baseline * 0.9 ? 'degraded' : 'flat';
        appendStrategyEvaluation(
          {
            super_identity_id: sid,
            linked_event_id: st.pending_evaluation?.linked_event_id || null,
            result,
            before_reward: baseline,
            after_reward: current,
            decision: 'kept'
          },
          { dataDir }
        ).catch(() => {});

        if (st.last_adjustment_source === 'imitation_hint' || st.imitation_reference) {
          appendImitationEvaluation(
            {
              super_identity_id: sid,
              linked_event_id: st.pending_evaluation?.linked_event_id || null,
              result,
              before_reward: baseline,
              after_reward: current,
              decision: 'kept',
              context: {
                candidate_strategy_type: st.imitation_reference?.candidate_strategy_type || null,
                candidate_reference_sid: null,
                reward_delta: Number(current) - Number(baseline)
              }
            },
            { dataDir }
          ).catch(() => {});
        }
      } catch {}

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

  let last_adjustment_source = 'local_signal';
  let imitation_reference = null;

  // Imitation (optional): only when local signal produces no safe proposal
  if (!proposed) {
    const cand = findImitationCandidate(sid, { dataDir });
    if (cand.ok && cand.suggested_adjustment) {
      const applied = applyImitationSuggestionToParams(cur, cand.suggested_adjustment);
      if (applied.ok) {
        proposed = applied.next_params;
        reason = cand.reason;
        last_adjustment_source = 'imitation_hint';
        imitation_reference = {
          candidate_strategy_type: cand.candidate_strategy_type,
          reason: cand.reason
        };
      }
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

  // derive adjustment type/delta (explainable)
  let adjType = 'weight_up';
  let adjDelta = 0;
  if (Number(proposed.threshold_adjustment) !== Number(cur.threshold_adjustment)) {
    adjDelta = Number(proposed.threshold_adjustment) - Number(cur.threshold_adjustment);
    adjType = adjDelta >= 0 ? 'threshold_up' : 'threshold_down';
  } else {
    const tKeys = new Set([...Object.keys(cur.task_weights || {}), ...Object.keys(proposed.task_weights || {})]);
    for (const k of tKeys) {
      const d = Number(proposed.task_weights?.[k] ?? 1) - Number(cur.task_weights?.[k] ?? 1);
      if (d !== 0) {
        adjDelta = d;
        adjType = d >= 0 ? 'weight_up' : 'weight_down';
        break;
      }
    }
    if (adjDelta === 0) {
      const cKeys = new Set([...Object.keys(cur.channel_weights || {}), ...Object.keys(proposed.channel_weights || {})]);
      for (const k of cKeys) {
        const d = Number(proposed.channel_weights?.[k] ?? 1) - Number(cur.channel_weights?.[k] ?? 1);
        if (d !== 0) {
          adjDelta = d;
          adjType = d >= 0 ? 'weight_up' : 'weight_down';
          break;
        }
      }
    }
  }

  const linked_event_id = `evt-${crypto.randomUUID()}`;

  const next = {
    ...st,
    current_params: proposed,
    last_adjustment_at: nowIso(now),
    last_adjustment_reason: reason,
    last_adjustment_source,
    imitation_reference,
    rollback_candidate: { previous_params: cur },
    pending_evaluation: {
      applied_at: nowIso(now),
      baseline_reward_last_24h: Number(localE?.trend?.reward_last_24h ?? 0),
      linked_event_id
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

  // best-effort timeline write (append-only; must not block strategy flow)
  try {
    const profileDoc = safeReadJson(getPaths({ dataDir }).profiles);
    const profile = profileDoc?.profiles?.find?.((p) => p.sid === sid) || null;

    appendStrategyEvent(
      {
        event_id: linked_event_id,
        super_identity_id: sid,
        adjustment: { type: adjType, delta: Number(adjDelta || 0), reason, source: last_adjustment_source, imitation_reference },
        before: {
          threshold_adjustment: Number(cur.threshold_adjustment ?? 0),
          reward_last_24h: Number(localE?.trend?.reward_last_24h ?? 0),
          avg_reward_per_task: Number(profile?.avg_reward_per_task ?? 0)
        },
        after: {
          threshold_adjustment: Number(proposed.threshold_adjustment ?? 0)
        },
        evaluation: {
          baseline_reward_24h: Number(localE?.trend?.reward_last_24h ?? 0)
        }
      },
      { dataDir }
    ).catch(() => {});

    // learning ledger (observability only)
    if (last_adjustment_source === 'imitation_hint') {
      let sugType = 'task_weight_up';
      if (adjType === 'threshold_up' || adjType === 'threshold_down') sugType = adjType;
      else {
        const tKeys = new Set([...Object.keys(cur.task_weights || {}), ...Object.keys(proposed.task_weights || {})]);
        let taskChanged = false;
        for (const k of tKeys) {
          const d = Number(proposed.task_weights?.[k] ?? 1) - Number(cur.task_weights?.[k] ?? 1);
          if (d !== 0) {
            taskChanged = true;
            sugType = d >= 0 ? 'task_weight_up' : 'task_weight_down';
            break;
          }
        }
        if (!taskChanged) {
          const cKeys = new Set([...Object.keys(cur.channel_weights || {}), ...Object.keys(proposed.channel_weights || {})]);
          for (const k of cKeys) {
            const d = Number(proposed.channel_weights?.[k] ?? 1) - Number(cur.channel_weights?.[k] ?? 1);
            if (d !== 0) {
              sugType = d >= 0 ? 'channel_weight_up' : 'channel_weight_down';
              break;
            }
          }
        }
      }

      appendImitationReference(
        {
          super_identity_id: sid,
          source: {
            type: 'imitation_hint',
            candidate_strategy_type: imitation_reference?.candidate_strategy_type || null,
            candidate_reference_sid: null
          },
          context: {
            linked_strategy_timeline_event_id: linked_event_id,
            local_strategy_type_before: profile?.strategy_type || null,
            suggested_adjustment: { type: sugType, delta: Number(adjDelta || 0) },
            reason
          }
        },
        { dataDir }
      ).catch(() => {});
    }
  } catch {}

  return { ok: true, action: 'applied', state: next };
}
