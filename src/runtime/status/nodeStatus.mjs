function isStringArray(x) {
  if (!Array.isArray(x)) return false;
  return x.every((v) => typeof v === 'string');
}

export function getNodeStatus({
  node_id = null,
  relay_connected = false,
  capabilities = [],
  peers = [],
  friendships = []
} = {}) {
  if (node_id !== null && typeof node_id !== 'string') {
    return { ok: false, error: { code: 'INVALID_NODE_ID' } };
  }
  if (typeof relay_connected !== 'boolean') {
    return { ok: false, error: { code: 'INVALID_RELAY_CONNECTED' } };
  }

  if (!isStringArray(capabilities)) {
    return { ok: false, error: { code: 'INVALID_CAPABILITIES' } };
  }
  if (!isStringArray(peers)) {
    return { ok: false, error: { code: 'INVALID_PEERS' } };
  }
  if (!isStringArray(friendships)) {
    return { ok: false, error: { code: 'INVALID_FRIENDSHIPS' } };
  }

  const caps = [...capabilities].sort((a, b) => String(a).localeCompare(String(b)));
  const ps = [...peers].sort((a, b) => String(a).localeCompare(String(b)));
  const fr = [...friendships].sort((a, b) => String(a).localeCompare(String(b)));

  return {
    ok: true,
    node_id,
    relay_connected,
    capabilities: caps,
    peers: ps,
    friendships: fr
  };
}
