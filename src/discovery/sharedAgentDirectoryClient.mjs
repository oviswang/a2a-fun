function nonEmptyString(x) {
  return typeof x === 'string' && x.trim() !== '';
}

function fail(code, extra = {}) {
  return { ok: false, error: { code: String(code || 'FAILED').slice(0, 64), ...extra } };
}

function safeBaseUrl(base_url) {
  if (!nonEmptyString(base_url)) return null;
  try {
    const u = new URL(base_url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    // strip trailing slash
    return u.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export async function publishAgentCardRemote({ base_url, agent_id, card } = {}) {
  const base = safeBaseUrl(base_url);
  if (!base) return { ok: false, published: false, agent_id: null, error: { code: 'INVALID_BASE_URL' } };
  if (!nonEmptyString(agent_id)) return { ok: false, published: false, agent_id: null, error: { code: 'INVALID_AGENT_ID' } };
  if (!card || typeof card !== 'object') return { ok: false, published: false, agent_id: agent_id.trim(), error: { code: 'INVALID_CARD' } };

  try {
    const r = await fetch(`${base}/agents/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent_id: agent_id.trim(), card })
    });

    const j = await r.json().catch(() => null);
    if (r.ok && j && j.ok === true) {
      return { ok: true, published: true, agent_id: j.agent_id || agent_id.trim(), error: null };
    }
    return { ok: false, published: false, agent_id: agent_id.trim(), error: { code: (j && j.error) || 'PUBLISH_FAILED' } };
  } catch (e) {
    return { ok: false, published: false, agent_id: agent_id.trim(), error: { code: String(e?.code || 'NETWORK_FAILED').slice(0, 64) } };
  }
}

export async function listPublishedAgentsRemote({ base_url } = {}) {
  const base = safeBaseUrl(base_url);
  if (!base) return { ok: false, agents: [], error: { code: 'INVALID_BASE_URL' } };

  try {
    const r = await fetch(`${base}/agents`);
    const j = await r.json().catch(() => null);
    if (r.ok && j && j.ok === true && Array.isArray(j.agents)) {
      return { ok: true, agents: j.agents, error: null };
    }
    return { ok: false, agents: [], error: { code: (j && j.error) || 'LIST_FAILED' } };
  } catch (e) {
    return { ok: false, agents: [], error: { code: String(e?.code || 'NETWORK_FAILED').slice(0, 64) } };
  }
}

export async function searchPublishedAgentsRemote({ base_url, query } = {}) {
  const base = safeBaseUrl(base_url);
  if (!base) return { ok: false, results: [], error: { code: 'INVALID_BASE_URL' } };
  if (typeof query !== 'string') return { ok: false, results: [], error: { code: 'INVALID_QUERY' } };

  try {
    const u = new URL(`${base}/agents/search`);
    u.searchParams.set('q', query);

    const r = await fetch(u.toString());
    const j = await r.json().catch(() => null);
    if (r.ok && j && j.ok === true && Array.isArray(j.results)) {
      return { ok: true, results: j.results, error: null };
    }
    return { ok: false, results: [], error: { code: (j && j.error) || 'SEARCH_FAILED' } };
  } catch (e) {
    return { ok: false, results: [], error: { code: String(e?.code || 'NETWORK_FAILED').slice(0, 64) } };
  }
}
