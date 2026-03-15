import { loadLocalAgentMemory, saveLocalAgentMemory, getDefaultLocalAgentMemoryPath, upsertLocalAgentMemoryRecord } from './localAgentMemory.mjs';

function nowIso() {
  return new Date().toISOString();
}

function normalizeId(x) {
  return typeof x === 'string' && x.trim() ? x.trim() : null;
}

function stateRank(s) {
  const order = ['discovered', 'introduced', 'engaged', 'interested', 'friend', 'trusted'];
  const i = order.indexOf(String(s || '').trim());
  return i >= 0 ? i : -1;
}

function upgradeState(cur, next) {
  const a = stateRank(cur);
  const b = stateRank(next);
  if (b < 0) return cur;
  if (a < 0) return next;
  return b > a ? next : cur;
}

export async function markAgentInterested({ workspace_path, peer_agent_id } = {}) {
  const peer = normalizeId(peer_agent_id);
  if (!peer) return { ok: false, error: { code: 'INVALID_PEER_AGENT_ID' } };

  const file_path = getDefaultLocalAgentMemoryPath({ workspace_path });
  const loaded = await loadLocalAgentMemory({ file_path });
  if (!loaded.ok) return { ok: false, error: loaded.error };

  // Upsert baseline record if missing.
  const up = upsertLocalAgentMemoryRecord({
    records: loaded.records,
    patch: {
      stable_agent_id: peer.startsWith('aid:sha256:') ? peer : null,
      legacy_agent_id: peer.startsWith('aid:sha256:') ? null : peer,
      relationship_state: 'interested',
      local_human_interest: true
    }
  });
  if (!up.ok) return { ok: false, error: up.error };

  // Add human_interest_at (additive field; keep schema minimal but include timestamp).
  const ts = nowIso();
  const records2 = up.records.map((r) => {
    const sid = r?.stable_agent_id || null;
    const lid = r?.legacy_agent_id || null;
    const match = (peer.startsWith('aid:sha256:') && sid === peer) || (!peer.startsWith('aid:sha256:') && lid === peer);
    if (!match) return r;
    return {
      ...r,
      relationship_state: upgradeState(r.relationship_state, 'interested'),
      local_human_interest: true,
      human_interest_at: ts
    };
  });

  await saveLocalAgentMemory({ file_path, records: records2 });

  console.log(JSON.stringify({ ok: true, event: 'AGENT_INTEREST_MARKED', peer_agent_id: peer, timestamp: ts }));

  return { ok: true };
}
