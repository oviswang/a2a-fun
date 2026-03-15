function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function fail(requested_peer_id, code) {
  return {
    ok: false,
    requested_peer_id,
    resolved_peer_id: null,
    resolution_reason: null,
    error: { code: String(code || 'FAILED').slice(0, 64) }
  };
}

function scoreCandidate({ candidate_id, requested_peer_id, localMemoryRecord } = {}) {
  let score = 0;
  if (!candidate_id) return 0;
  if (candidate_id === requested_peer_id) score += 100;

  const req = safeStr(requested_peer_id);
  if (req && candidate_id.startsWith(req + '-')) score += 50;

  const state = safeStr(localMemoryRecord?.relationship_state);
  if (state === 'interested') score += 10;
  if (state === 'engaged') score += 8;
  if (state === 'introduced') score += 4;

  const last = safeStr(localMemoryRecord?.last_seen_at || localMemoryRecord?.updated_at || localMemoryRecord?.last_handshake_at || '');
  if (last) score += 1;

  return score;
}

export async function resolveLivePeerId({ requested_peer_id, local_memory, directory_agents } = {}) {
  const req = safeStr(requested_peer_id);
  console.log(JSON.stringify({ ok: true, event: 'PEER_ID_RESOLUTION_STARTED', requested_peer_id: req }));
  if (!req) return fail(req, 'MISSING_REQUESTED_PEER_ID');

  const memRecords = Array.isArray(local_memory?.records) ? local_memory.records : [];
  const dirAgents = Array.isArray(directory_agents) ? directory_agents : [];

  // Directory candidate ids
  const liveIds = dirAgents.map((a) => safeStr(a?.agent_id)).filter(Boolean);

  // 1) Exact match preferred
  if (liveIds.includes(req)) {
    const out = { ok: true, requested_peer_id: req, resolved_peer_id: req, resolution_reason: 'exact_directory_match', error: null };
    console.log(JSON.stringify({ ok: true, event: 'PEER_ID_RESOLUTION_RESULT', ...out }));
    return out;
  }

  // 2) legacy -> single suffixed match
  const suffixed = liveIds.filter((id) => id.startsWith(req + '-'));

  if (suffixed.length === 1) {
    const out = { ok: true, requested_peer_id: req, resolved_peer_id: suffixed[0], resolution_reason: 'single_suffixed_directory_match', error: null };
    console.log(JSON.stringify({ ok: true, event: 'PEER_ID_RESOLUTION_RESULT', ...out }));
    return out;
  }

  // 3) multiple suffixed: use best local-memory record match (relationship + recency hint)
  if (suffixed.length > 1) {
    const byLegacy = memRecords.find((r) => safeStr(r?.legacy_agent_id) === req) || null;
    const scored = suffixed
      .map((id) => ({ id, score: scoreCandidate({ candidate_id: id, requested_peer_id: req, localMemoryRecord: byLegacy }) }))
      .sort((a, b) => b.score - a.score);

    const chosen = scored[0]?.id || null;
    if (chosen) {
      const out = { ok: true, requested_peer_id: req, resolved_peer_id: chosen, resolution_reason: 'multi_suffixed_best_memory_match', error: null };
      console.log(JSON.stringify({ ok: true, event: 'PEER_ID_RESOLUTION_RESULT', ...out, candidates: suffixed }));
      return out;
    }
  }

  // 4) fallback: if local memory knows a stable id and it exists in directory
  const rec = memRecords.find((r) => safeStr(r?.legacy_agent_id) === req || safeStr(r?.stable_agent_id) === req) || null;
  const stable = safeStr(rec?.stable_agent_id);
  if (stable && liveIds.includes(stable)) {
    const out = { ok: true, requested_peer_id: req, resolved_peer_id: stable, resolution_reason: 'stable_id_from_memory', error: null };
    console.log(JSON.stringify({ ok: true, event: 'PEER_ID_RESOLUTION_RESULT', ...out }));
    return out;
  }

  const out = fail(req, 'NO_LIVE_PEER_MATCH');
  console.log(JSON.stringify({ ok: true, event: 'PEER_ID_RESOLUTION_FAILED', requested_peer_id: req, error: out.error }));
  return out;
}
