function num(x, dflt) {
  const n = Number(x);
  return Number.isFinite(n) ? n : dflt;
}

/**
 * routeTaskWithFallback
 *
 * sendFn signature:
 *   ({ candidate, taskPayload }) => Promise<{ accepted: boolean, reason?: string, response?: any }>
 */
export async function routeTaskWithFallback({ candidates, taskPayload, sendFn, maxAttempts } = {}) {
  const cand = Array.isArray(candidates) ? candidates : [];
  const max = num(maxAttempts, 5);
  if (typeof sendFn !== 'function') return { ok: false, error: { code: 'MISSING_SEND_FN' } };

  const attempts = [];
  const n = Math.min(max, cand.length);
  for (let i = 0; i < n; i++) {
    const c = cand[i];
    const out = await sendFn({ candidate: c, taskPayload });
    attempts.push({ candidate: c?.node_id || c?.agent_id || null, accepted: !!out?.accepted, reason: out?.reason || null });
    if (out?.accepted) {
      return { ok: true, selected: c, attempts, response: out?.response ?? null };
    }
  }

  return { ok: false, error: { code: 'ALL_REJECTED' }, attempts };
}
