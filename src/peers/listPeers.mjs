function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

export function listPeers({ table, only_targetable = false } = {}) {
  const peers = Array.isArray(table?.peers) ? table.peers : [];
  const filtered = only_targetable ? peers.filter((p) => p?.liveness?.on_relay === true) : peers;

  const sorted = [...filtered].sort((a, b) => {
    const ar = a?.liveness?.on_relay === true;
    const br = b?.liveness?.on_relay === true;
    if (ar !== br) return ar ? -1 : 1; // reachable first
    return safeStr(a?.peer_id).localeCompare(safeStr(b?.peer_id));
  });

  return {
    ok: true,
    peers: sorted,
    counts: {
      total: peers.length,
      targetable: peers.filter((p) => p?.liveness?.on_relay === true).length
    }
  };
}
