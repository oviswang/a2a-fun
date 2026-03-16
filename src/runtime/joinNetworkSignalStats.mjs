// joinNetworkSignalStats.mjs
// Purpose: Fetch + validate /network_stats for JOIN_NETWORK_SIGNAL.
// Stats are considered AVAILABLE only when schema matches expected types.

export async function fetchAndValidateNetworkStats({
  url = 'https://bootstrap.a2a.fun/network_stats',
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== 'function') {
    return { ok: true, available: false, reason: 'NO_FETCH' };
  }

  let r = null;
  try {
    r = await fetchImpl(url, { method: 'GET' });
  } catch {
    return { ok: true, available: false, reason: 'FETCH_ERROR' };
  }

  // Parse JSON only if HTTP 200.
  if (!r || r.status !== 200) {
    return { ok: true, available: false, reason: `HTTP_${Number(r?.status || 0)}` };
  }

  let body = null;
  try {
    body = await r.json();
  } catch {
    return { ok: true, available: false, reason: 'INVALID_JSON' };
  }

  const connected = body?.connected_nodes;
  const active24h = body?.active_agents_last_24h;
  const regions = body?.regions;

  const valid =
    typeof connected === 'number' &&
    Number.isFinite(connected) &&
    typeof active24h === 'number' &&
    Number.isFinite(active24h) &&
    Array.isArray(regions);

  if (!valid) {
    return { ok: true, available: false, reason: 'SCHEMA_MISMATCH' };
  }

  return {
    ok: true,
    available: true,
    stats: {
      connected_nodes: connected,
      active_agents_last_24h: active24h,
      regions
    }
  };
}
