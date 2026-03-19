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

export function computeCurrentThreshold({ base_threshold, inflight, reputation_score, last_accepted_at } = {}) {
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

  const raw = base + overload_penalty + reputation_bonus - idle_discount;
  return {
    base_threshold: base,
    overload_penalty,
    reputation_bonus,
    idle_discount,
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
export function shouldAcceptTask({ expected_value, reputation_score }, { node_id, dataDir } = {}) {
  const maxInflight = num(process.env.A2A_MAX_INFLIGHT, 3);

  const ev = num(expected_value, 1);
  const rep = num(reputation_score, 0);

  const loaded = loadMarketState({ dataDir });
  const st = loaded.state;

  const formula = computeCurrentThreshold({
    base_threshold: num(process.env.A2A_BASE_THRESHOLD, 1),
    inflight,
    reputation_score: rep,
    last_accepted_at: st.last_accepted_at
  });

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
  } else if (ev < smoothed) {
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
      expected_value: ev,
      current_threshold: smoothed,
      inflight,
      maxInflight,
      reputation_score: rep,
      formula
    }
  };
}
