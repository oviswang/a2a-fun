import { getReputation } from '../reputation/reputation.mjs';

function nowIso() {
  return new Date().toISOString();
}

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function clamp(x, lo, hi) {
  const n = Number(x);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export function normalizeReputationScore(rawScore) {
  const clamped = clamp(rawScore, -10, 10);
  return (clamped + 10) / 20;
}

function containsAny(haystack, needles) {
  const h = safeStr(haystack).toLowerCase();
  if (!h) return false;
  for (const n of needles || []) {
    const t = safeStr(n).toLowerCase();
    if (!t) continue;
    if (h.includes(t)) return true;
  }
  return false;
}

function overlapScore(text, topics) {
  // Minimal capability proxy: topic overlap -> 1, else 0.
  return containsAny(text, topics) ? 1 : 0;
}

function freshnessScoreFromIso(last_seen_iso) {
  // 0..1 where 1 is very recent.
  const t = Date.parse(String(last_seen_iso || ''));
  if (!Number.isFinite(t)) return 0.5;
  const ageMs = Math.max(0, Date.now() - t);
  const hour = 3600_000;
  if (ageMs <= hour) return 1;
  if (ageMs >= 24 * hour) return 0;
  return 1 - ageMs / (24 * hour);
}

function trustScoreFromRelationship(state) {
  const s = safeStr(state);
  if (s === 'interested') return 1;
  if (s === 'engaged') return 0.8;
  if (s === 'introduced') return 0.6;
  if (s === 'discovered') return 0.4;
  return 0.5;
}

function weightDefault() {
  return { trust: 0.35, capability: 0.3, freshness: 0.2, reputation: 0.15 };
}

function logRoutingDecision(payload) {
  try {
    process.stdout.write(`${JSON.stringify({ ok: true, event: 'ROUTING_DECISION', ts: nowIso(), ...payload })}\n`);
  } catch {}
}

function weightedPick(items, rng) {
  const xs = items.filter((x) => Number.isFinite(x.weight) && x.weight > 0);
  if (xs.length === 0) return null;
  const total = xs.reduce((a, b) => a + b.weight, 0);
  let r = (typeof rng === 'function' ? rng() : Math.random()) * total;
  for (const it of xs) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return xs[xs.length - 1];
}

/**
 * Reputation-aware routing (v0.3.8)
 *
 * Inputs per candidate (best-effort):
 * - agent_id
 * - super_identity_id (optional)
 * - relationship_state (optional)
 * - skills/summary/name
 * - last_seen/last_active_at (optional)
 */
export function selectCandidateReputationAware({
  candidates,
  topics = [],
  weights,
  explorationRate = 0.15,
  rng,
  dataDir
} = {}) {
  const w = { ...weightDefault(), ...(weights || {}) };

  const cand = Array.isArray(candidates) ? candidates : [];
  if (cand.length === 0) return { ok: false, error: { code: 'NO_CANDIDATES' } };

  const scored = cand.map((c) => {
    const text = `${c?.name || ''} ${c?.summary || ''} ${Array.isArray(c?.skills) ? c.skills.join(' ') : ''}`;

    const trust_score = trustScoreFromRelationship(c?.relationship_state);
    const capability_score = overlapScore(text, topics);
    const freshness_score = freshnessScoreFromIso(c?.last_seen || c?.last_active_at);

    let rawRep = 0;
    let repNorm = 0.5;
    const sid = safeStr(c?.super_identity_id);
    if (sid.startsWith('sid-')) {
      const rep = getReputation(sid, { dataDir });
      rawRep = rep?.reputation?.score ?? 0;
      repNorm = normalizeReputationScore(rawRep);
    }

    const final_score =
      w.trust * trust_score +
      w.capability * capability_score +
      w.freshness * freshness_score +
      w.reputation * repNorm;

    return {
      candidate: c,
      components: { trust_score, capability_score, freshness_score, reputation_score_normalized: repNorm, raw_reputation_score: rawRep },
      final_score
    };
  });

  const sorted = [...scored].sort((a, b) => b.final_score - a.final_score);
  const top = sorted[0];

  const p = typeof rng === 'function' ? rng() : Math.random();
  const useExploration = sorted.length >= 2 && p < clamp(explorationRate, 0, 0.5);

  let chosen = null;
  let reason = 'highest_score';

  const gamma = 3; // sharper weighting while staying explainable (no hard exclusion)

  if (useExploration) {
    reason = 'exploration';
    const rest = sorted.slice(1);
    const picked = weightedPick(
      rest.map((x) => ({ ...x, weight: Math.max(0.0001, x.final_score) ** gamma })),
      rng
    );
    chosen = picked || top;
  } else {
    // Weighted selection (soft) with sharper bias towards higher scores.
    const picked = weightedPick(
      sorted.map((x) => ({ ...x, weight: Math.max(0.0001, x.final_score) ** gamma })),
      rng
    );
    chosen = picked || top;
    reason = chosen === top ? 'highest_score' : 'weighted_random';
  }

  const decision = {
    ok: true,
    selected: {
      agent_id: chosen?.candidate?.agent_id || null,
      super_identity_id: chosen?.candidate?.super_identity_id || null
    },
    reason,
    exploration_used: useExploration,
    weights: w,
    candidates: sorted.slice(0, 8).map((x) => ({
      agent_id: x.candidate?.agent_id || null,
      super_identity_id: x.candidate?.super_identity_id || null,
      final_score: x.final_score,
      components: x.components
    }))
  };

  logRoutingDecision(decision);
  return decision;
}
