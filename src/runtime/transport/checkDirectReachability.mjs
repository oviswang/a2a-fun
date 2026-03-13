/**
 * Minimal direct transport reachability probe.
 *
 * Purpose:
 * - Answer: "Is this peer URL reachable over HTTP within timeout?"
 *
 * Non-goals:
 * - protocol interpretation
 * - sending protocol envelopes
 * - friendship logic
 * - orchestration/selection
 */
export async function checkDirectReachability({ peerUrl, timeoutMs = 3000 } = {}) {
  if (!peerUrl || typeof peerUrl !== 'string') {
    const e = new Error('checkDirectReachability: peerUrl must be string');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000) {
    const e = new Error('checkDirectReachability: timeoutMs must be 1..30000');
    e.code = 'INVALID_INPUT';
    throw e;
  }

  // Normalize & validate URL shape (machine-safe).
  let url;
  try {
    url = new URL(peerUrl);
  } catch {
    return { directReachable: false, reason: 'INVALID_URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { directReachable: false, reason: 'INVALID_URL' };
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Minimal reachability check: GET with no body.
    // Any HTTP response (even 404) counts as reachable.
    const res = await fetch(url.toString(), {
      method: 'GET',
      signal: controller.signal,
      headers: { accept: 'application/json,text/plain,*/*' }
    });

    // Deterministic result shape.
    return { directReachable: true, status: res.status };
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) {
      return { directReachable: false, reason: 'TIMEOUT' };
    }
    return { directReachable: false, reason: 'UNREACHABLE' };
  } finally {
    clearTimeout(t);
  }
}
