function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function fail(code) {
  return { ok: false, candidates: [], error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export async function scoutAgentsFromSharedDirectory({ sharedClient, base_url, local_agent_card } = {}) {
  if (!isObj(sharedClient) || typeof sharedClient.listPublishedAgentsRemote !== 'function') {
    return fail('INVALID_SHARED_CLIENT');
  }
  if (!isObj(local_agent_card) || typeof local_agent_card.agent_id !== 'string') {
    return fail('INVALID_LOCAL_AGENT_CARD');
  }

  const selfId = String(local_agent_card.agent_id || '').trim();
  const transportId = typeof globalThis.__A2A_TRANSPORT_NODE_ID === 'string' ? globalThis.__A2A_TRANSPORT_NODE_ID.trim() : '';
  const selfIds = new Set([selfId, transportId].filter(Boolean));

  try {
    const out = await sharedClient.listPublishedAgentsRemote({ base_url });
    if (!out || out.ok !== true || !Array.isArray(out.agents)) return fail(out?.error?.code || 'DIRECTORY_FETCH_FAILED');

    const ids = out.agents
      .map((a) => (a && typeof a.agent_id === 'string' ? a.agent_id.trim() : null))
      .filter((x) => typeof x === 'string' && x && !selfIds.has(x));

    const uniq = [...new Set(ids)].sort((a, b) => String(a).localeCompare(String(b)));

    return { ok: true, candidates: uniq, error: null };
  } catch {
    return fail('DIRECTORY_FETCH_FAILED');
  }
}
