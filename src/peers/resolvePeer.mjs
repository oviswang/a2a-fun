function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

export function resolvePeer({ table, requested_peer_id } = {}) {
  const req = safeStr(requested_peer_id);
  const peers = Array.isArray(table?.peers) ? table.peers : [];

  if (!req) {
    return { ok: false, requested_peer_id: req, resolved_peer_id: null, reason: null, error: { code: 'MISSING_REQUESTED_PEER_ID' } };
  }

  const exact = peers.find((p) => safeStr(p?.peer_id) === req) || null;
  if (exact && exact?.liveness?.on_relay === true) {
    return { ok: true, requested_peer_id: req, resolved_peer_id: req, reason: 'exact_match_targetable', error: null };
  }
  if (exact) {
    // exists but not targetable
    return { ok: false, requested_peer_id: req, resolved_peer_id: req, reason: 'exact_match_not_on_relay', error: { code: 'PEER_NOT_TARGETABLE' } };
  }

  // Prefix match for collision-safe ids (legacy -> suffixed)
  const suffixed = peers.filter((p) => safeStr(p?.peer_id).startsWith(req + '-'));
  const targetable = suffixed.filter((p) => p?.liveness?.on_relay === true);

  if (targetable.length === 1) {
    return { ok: true, requested_peer_id: req, resolved_peer_id: safeStr(targetable[0].peer_id), reason: 'single_suffixed_targetable', error: null };
  }
  if (targetable.length > 1) {
    // Deterministic tie-break: newest last_seen, then lexicographic
    const pick = [...targetable].sort((a, b) => {
      const as = safeStr(a?.liveness?.last_seen);
      const bs = safeStr(b?.liveness?.last_seen);
      if (as && bs && as !== bs) return bs.localeCompare(as);
      return safeStr(a?.peer_id).localeCompare(safeStr(b?.peer_id));
    })[0];
    return { ok: true, requested_peer_id: req, resolved_peer_id: safeStr(pick.peer_id), reason: 'multi_suffixed_targetable_best_last_seen', error: null };
  }

  // If no targetable, but suffixed exists in inventory
  if (suffixed.length === 1) {
    return { ok: false, requested_peer_id: req, resolved_peer_id: safeStr(suffixed[0].peer_id), reason: 'single_suffixed_not_on_relay', error: { code: 'PEER_NOT_TARGETABLE' } };
  }

  return { ok: false, requested_peer_id: req, resolved_peer_id: null, reason: 'no_match', error: { code: 'PEER_NOT_FOUND' } };
}
