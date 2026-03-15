import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_RELATIONSHIP_STATES = ['discovered', 'introduced', 'engaged', 'interested', 'friend', 'trusted'];

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function nonEmptyString(x) {
  return typeof x === 'string' && x.trim() !== '';
}

function nowIso() {
  return new Date().toISOString();
}

function fail(code) {
  return { ok: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

function defaultData() {
  return { ok: true, records: [] };
}

function normalizeId(x) {
  if (!nonEmptyString(x)) return null;
  return String(x).trim();
}

function stateRank(s) {
  const idx = DEFAULT_RELATIONSHIP_STATES.indexOf(String(s || '').trim());
  return idx >= 0 ? idx : -1;
}

function upgradeState(cur, next) {
  const a = stateRank(cur);
  const b = stateRank(next);
  if (b < 0) return cur;
  if (a < 0) return next;
  return b > a ? next : cur;
}

function stableSortRecords(records) {
  return [...records].sort((a, b) => {
    const ka = String(a.stable_agent_id || a.legacy_agent_id || '').trim();
    const kb = String(b.stable_agent_id || b.legacy_agent_id || '').trim();
    return ka.localeCompare(kb);
  });
}

export function getDefaultLocalAgentMemoryPath({ workspace_path } = {}) {
  const ws = nonEmptyString(workspace_path) ? workspace_path.trim() : process.cwd();
  return path.join(ws, 'data', 'local_agent_memory.json');
}

export async function loadLocalAgentMemory({ file_path } = {}) {
  if (!nonEmptyString(file_path)) return fail('INVALID_FILE_PATH');

  try {
    const raw = await fs.readFile(file_path, 'utf8');
    const json = JSON.parse(raw);
    if (!isObj(json) || !Array.isArray(json.records)) return fail('CORRUPT_STORE');

    // Keep only object records.
    const records = json.records.filter(isObj);
    return { ok: true, records: stableSortRecords(records), error: null };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ...defaultData(), error: null };
    if (e && e.name === 'SyntaxError') return fail('CORRUPT_STORE');
    return fail('LOAD_FAILED');
  }
}

export async function saveLocalAgentMemory({ file_path, records } = {}) {
  if (!nonEmptyString(file_path)) return fail('INVALID_FILE_PATH');
  if (!Array.isArray(records) || records.some((r) => !isObj(r))) return fail('INVALID_RECORDS');

  const dir = path.dirname(file_path);
  await fs.mkdir(dir, { recursive: true });

  const payload = {
    ok: true,
    version: 'local_agent_memory.v0.1',
    records: stableSortRecords(records)
  };

  const tmp = `${file_path}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2));
  await fs.rename(tmp, file_path);

  return { ok: true, saved: true, error: null };
}

function findRecordIndex(records, { stable_agent_id, legacy_agent_id }) {
  const sid = normalizeId(stable_agent_id);
  const lid = normalizeId(legacy_agent_id);

  if (sid) {
    const i = records.findIndex((r) => normalizeId(r.stable_agent_id) === sid);
    if (i >= 0) return i;
  }
  if (lid) {
    const i = records.findIndex((r) => normalizeId(r.legacy_agent_id) === lid);
    if (i >= 0) return i;
  }
  return -1;
}

export function upsertLocalAgentMemoryRecord({ records, patch } = {}) {
  if (!Array.isArray(records)) return { ok: false, records: [], error: { code: 'INVALID_RECORDS' } };
  if (!isObj(patch)) return { ok: false, records, error: { code: 'INVALID_PATCH' } };

  const stable_agent_id = normalizeId(patch.stable_agent_id);
  const legacy_agent_id = normalizeId(patch.legacy_agent_id);
  if (!stable_agent_id && !legacy_agent_id) return { ok: false, records, error: { code: 'MISSING_AGENT_ID' } };

  const idx = findRecordIndex(records, { stable_agent_id, legacy_agent_id });
  const existing = idx >= 0 ? records[idx] : null;

  const merged = {
    stable_agent_id: stable_agent_id || normalizeId(existing?.stable_agent_id) || null,
    legacy_agent_id: legacy_agent_id || normalizeId(existing?.legacy_agent_id) || null,
    display_name: typeof patch.display_name === 'string' ? patch.display_name.trim() : (existing?.display_name || ''),
    summary: typeof patch.summary === 'string' ? patch.summary.trim() : (existing?.summary || ''),
    relationship_state: upgradeState(existing?.relationship_state, patch.relationship_state || existing?.relationship_state || 'discovered'),
    source: isObj(patch.source) ? patch.source : (existing?.source || null),
    first_seen_at: existing?.first_seen_at || patch.first_seen_at || nowIso(),
    last_seen_at: patch.last_seen_at || nowIso(),
    last_handshake_at: patch.last_handshake_at || (existing?.last_handshake_at || null),
    last_dialogue_at: patch.last_dialogue_at || (existing?.last_dialogue_at || null),
    last_summary: typeof patch.last_summary === 'string' ? patch.last_summary.trim() : (existing?.last_summary || ''),
    local_human_interest: typeof patch.local_human_interest === 'boolean' ? patch.local_human_interest : (existing?.local_human_interest || false),
    remote_human_interest: typeof patch.remote_human_interest === 'boolean' ? patch.remote_human_interest : (existing?.remote_human_interest || false),
    friendship_established: typeof patch.friendship_established === 'boolean' ? patch.friendship_established : (existing?.friendship_established || false),
    local_trust_score: Number.isFinite(patch.local_trust_score) ? patch.local_trust_score : (Number.isFinite(existing?.local_trust_score) ? existing.local_trust_score : 0),
    trusted_refs_count: Number.isInteger(patch.trusted_refs_count) ? patch.trusted_refs_count : (Number.isInteger(existing?.trusted_refs_count) ? existing.trusted_refs_count : 0)
  };

  const nextRecords = idx >= 0
    ? records.map((r, i) => (i === idx ? merged : r))
    : [...records, merged];

  return { ok: true, records: stableSortRecords(nextRecords), error: null };
}

// High-level helpers (best-effort and deterministic)
export async function upsertDiscoveredAgent({ workspace_path, peer_agent_id, display_name = '', summary = '', source = { type: 'directory' } } = {}) {
  const file_path = getDefaultLocalAgentMemoryPath({ workspace_path });
  const peer = normalizeId(peer_agent_id);
  if (!peer) return fail('INVALID_PEER_AGENT_ID');

  const loaded = await loadLocalAgentMemory({ file_path });
  if (!loaded.ok) return loaded;

  const up = upsertLocalAgentMemoryRecord({
    records: loaded.records,
    patch: {
      stable_agent_id: peer.startsWith('aid:sha256:') ? peer : null,
      legacy_agent_id: peer.startsWith('aid:sha256:') ? null : peer,
      display_name,
      summary,
      relationship_state: 'discovered',
      source,
      last_seen_at: nowIso()
    }
  });
  if (!up.ok) return fail(up.error?.code || 'UPSERT_FAILED');

  await saveLocalAgentMemory({ file_path, records: up.records });
  return { ok: true };
}

export async function markAgentEngaged({ workspace_path, peer_agent_id, last_summary = '' } = {}) {
  const file_path = getDefaultLocalAgentMemoryPath({ workspace_path });
  const peer = normalizeId(peer_agent_id);
  if (!peer) return fail('INVALID_PEER_AGENT_ID');

  const loaded = await loadLocalAgentMemory({ file_path });
  if (!loaded.ok) return loaded;

  const up = upsertLocalAgentMemoryRecord({
    records: loaded.records,
    patch: {
      stable_agent_id: peer.startsWith('aid:sha256:') ? peer : null,
      legacy_agent_id: peer.startsWith('aid:sha256:') ? null : peer,
      relationship_state: 'engaged',
      last_dialogue_at: nowIso(),
      last_summary
    }
  });
  if (!up.ok) return fail(up.error?.code || 'UPSERT_FAILED');

  await saveLocalAgentMemory({ file_path, records: up.records });
  return { ok: true };
}

export async function markFriendshipEstablished({ workspace_path, peer_agent_id } = {}) {
  const file_path = getDefaultLocalAgentMemoryPath({ workspace_path });
  const peer = normalizeId(peer_agent_id);
  if (!peer) return fail('INVALID_PEER_AGENT_ID');

  const loaded = await loadLocalAgentMemory({ file_path });
  if (!loaded.ok) return loaded;

  const up = upsertLocalAgentMemoryRecord({
    records: loaded.records,
    patch: {
      stable_agent_id: peer.startsWith('aid:sha256:') ? peer : null,
      legacy_agent_id: peer.startsWith('aid:sha256:') ? null : peer,
      relationship_state: 'friend',
      friendship_established: true
    }
  });
  if (!up.ok) return fail(up.error?.code || 'UPSERT_FAILED');

  await saveLocalAgentMemory({ file_path, records: up.records });
  return { ok: true };
}

export async function incrementLocalTrust({ workspace_path, peer_agent_id, delta = 1 } = {}) {
  const file_path = getDefaultLocalAgentMemoryPath({ workspace_path });
  const peer = normalizeId(peer_agent_id);
  if (!peer) return fail('INVALID_PEER_AGENT_ID');
  const d = Number.isFinite(delta) ? delta : 0;

  const loaded = await loadLocalAgentMemory({ file_path });
  if (!loaded.ok) return loaded;

  const idx = findRecordIndex(loaded.records, {
    stable_agent_id: peer.startsWith('aid:sha256:') ? peer : null,
    legacy_agent_id: peer.startsWith('aid:sha256:') ? null : peer
  });
  const cur = idx >= 0 ? loaded.records[idx] : null;
  const curScore = Number.isFinite(cur?.local_trust_score) ? cur.local_trust_score : 0;

  const up = upsertLocalAgentMemoryRecord({
    records: loaded.records,
    patch: {
      stable_agent_id: peer.startsWith('aid:sha256:') ? peer : null,
      legacy_agent_id: peer.startsWith('aid:sha256:') ? null : peer,
      relationship_state: 'trusted',
      local_trust_score: curScore + d
    }
  });
  if (!up.ok) return fail(up.error?.code || 'UPSERT_FAILED');

  await saveLocalAgentMemory({ file_path, records: up.records });
  return { ok: true };
}

export async function listLocalAgentMemory({ workspace_path } = {}) {
  const file_path = getDefaultLocalAgentMemoryPath({ workspace_path });
  const loaded = await loadLocalAgentMemory({ file_path });
  if (!loaded.ok) return { ok: false, count: 0, records: [], error: loaded.error };
  return { ok: true, count: loaded.records.length, records: loaded.records, error: null };
}
