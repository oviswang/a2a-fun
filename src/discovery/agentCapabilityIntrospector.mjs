function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function fail(code) {
  return { ok: false, capabilities: [], error: { code: String(code || 'FAILED').slice(0, 64) } };
}

function normCapId(x) {
  if (typeof x !== 'string') return null;
  const s = x.trim();
  if (!s) return null;
  if (s.length > 64) return null;
  return s;
}

export async function introspectLocalCapabilities({ base_url = 'http://127.0.0.1:3000' } = {}) {
  if (typeof base_url !== 'string' || !base_url.trim()) return fail('INVALID_BASE_URL');

  try {
    const r = await fetch(`${base_url.replace(/\/$/, '')}/capabilities`, { method: 'GET' });
    if (!r.ok) return fail('CAPABILITIES_UNREACHABLE');

    const json = await r.json().catch(() => null);
    if (!isObj(json) || json.ok !== true) return fail('CAPABILITIES_INVALID');

    const raw = Array.isArray(json.capabilities) ? json.capabilities : [];

    // Accept either:
    // - ["translate", ...]
    // - [{capability_id:"cap.translate", name:"translate"}, ...]
    // - [{capability_id:"translate"}, ...]
    const ids = [];
    for (const c of raw) {
      if (typeof c === 'string') {
        const v = normCapId(c);
        if (v) ids.push(v);
        continue;
      }
      if (isObj(c)) {
        const v = normCapId(c.name) || normCapId(c.capability_id) || null;
        if (v) ids.push(v);
      }
    }

    const uniq = [...new Set(ids)].sort((a, b) => a.localeCompare(b));
    return { ok: true, capabilities: uniq, error: null };
  } catch {
    return fail('CAPABILITIES_UNREACHABLE');
  }
}
