import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function safeReadJson(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(String(raw || ''));
  } catch {
    return null;
  }
}

function atomicWriteJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

function sid() {
  // stable enough; not a secret
  return `sid-${crypto.randomBytes(9).toString('hex')}`;
}

function key(channel, user_id) {
  return `${String(channel).trim().toLowerCase()}:${String(user_id).trim()}`;
}

export function getIdentityPaths({ dataDir } = {}) {
  const dir = dataDir || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'data');
  return {
    dataDir: dir,
    registry: path.join(dir, 'super_identity_registry.json'),
    links: path.join(dir, 'channel_identity_links.json'),
    merges: path.join(dir, 'identity_merge_history.json')
  };
}

function loadLinks(linksPath) {
  const j = safeReadJson(linksPath);
  if (j && isPlainObject(j)) return j;
  return { ok: true, updated_at: null, links: {} };
}

function loadRegistry(registryPath) {
  const j = safeReadJson(registryPath);
  if (j && isPlainObject(j) && Array.isArray(j.super_identities)) return j;
  return { ok: true, updated_at: null, super_identities: [] };
}

function saveLinks(linksPath, linksObj) {
  atomicWriteJson(linksPath, { ok: true, updated_at: nowIso(), links: linksObj });
}

function saveRegistry(registryPath, registryObj) {
  atomicWriteJson(registryPath, { ok: true, updated_at: nowIso(), super_identities: registryObj });
}

function appendMergeHistory(mergesPath, entry) {
  const j = safeReadJson(mergesPath);
  const arr = j && isPlainObject(j) && Array.isArray(j.history) ? j.history : [];
  arr.push(entry);
  atomicWriteJson(mergesPath, { ok: true, updated_at: nowIso(), history: arr.slice(-2000) });
}

function upsertSuperIdentity({ registry, super_identity_id, linked_identities, patch } = {}) {
  const idx = registry.findIndex((x) => x && x.super_identity_id === super_identity_id);
  const base = idx >= 0 ? registry[idx] : null;

  const next = {
    super_identity_id,
    linked_identities: Array.isArray(linked_identities) ? linked_identities : base?.linked_identities || [],
    created_at: base?.created_at || nowIso(),
    updated_at: nowIso(),
    status: base?.status || 'active',

    // Trust/reputation placeholders (no scoring logic yet)
    trust_profile: base?.trust_profile || null,
    reputation_seed: base?.reputation_seed || null,
    linked_node_count: base?.linked_node_count ?? 0,

    ...(isPlainObject(patch) ? patch : {})
  };

  if (idx >= 0) registry[idx] = next;
  else registry.push(next);

  return registry;
}

/**
 * resolveSuperIdentityId({ channel, user_id })
 *
 * Resolution rules:
 * 1) if already linked -> return existing super_identity_id
 * 2) else create new sid and link
 *
 * NO fuzzy merging.
 */
export function resolveSuperIdentityId({ channel, user_id, dataDir } = {}) {
  const { registry: registryPath, links: linksPath } = getIdentityPaths({ dataDir });

  const k = key(channel, user_id);
  const linksDoc = loadLinks(linksPath);
  const links = isPlainObject(linksDoc.links) ? linksDoc.links : {};

  const existing = typeof links[k] === 'string' ? links[k] : null;
  if (existing) {
    return { ok: true, super_identity_id: existing, created: false };
  }

  const newSid = sid();
  links[k] = newSid;
  saveLinks(linksPath, links);

  const regDoc = loadRegistry(registryPath);
  const reg = Array.isArray(regDoc.super_identities) ? regDoc.super_identities : [];

  upsertSuperIdentity({
    registry: reg,
    super_identity_id: newSid,
    linked_identities: [{ channel: String(channel), user_id: String(user_id) }]
  });
  saveRegistry(registryPath, reg);

  return { ok: true, super_identity_id: newSid, created: true };
}

/**
 * Explicit merge: link one or more channel identities into target super_identity_id.
 * Auditable + reversible (history records previous linkage).
 */
export function mergeIdentity({ sources, target_super_identity_id, dataDir } = {}) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return { ok: false, error: { code: 'INVALID_SOURCES' } };
  }
  if (typeof target_super_identity_id !== 'string' || !target_super_identity_id.startsWith('sid-')) {
    return { ok: false, error: { code: 'INVALID_TARGET_SUPER_ID' } };
  }

  const { registry: registryPath, links: linksPath, merges: mergesPath } = getIdentityPaths({ dataDir });

  const linksDoc = loadLinks(linksPath);
  const links = isPlainObject(linksDoc.links) ? linksDoc.links : {};

  const regDoc = loadRegistry(registryPath);
  const reg = Array.isArray(regDoc.super_identities) ? regDoc.super_identities : [];

  // Ensure target exists.
  upsertSuperIdentity({ registry: reg, super_identity_id: target_super_identity_id });

  const changes = [];
  for (const s of sources) {
    const ch = String(s?.channel || '').trim();
    const uid = String(s?.user_id || '').trim();
    if (!ch || !uid) continue;

    const k = key(ch, uid);
    const prev = typeof links[k] === 'string' ? links[k] : null;

    // No-op if already linked to target.
    if (prev === target_super_identity_id) continue;

    links[k] = target_super_identity_id;
    changes.push({ channel: ch, user_id: uid, prev_super_identity_id: prev, next_super_identity_id: target_super_identity_id });
  }

  if (changes.length === 0) {
    return { ok: true, merged: false, changes: [] };
  }

  // Update registry linked_identities sets.
  const target = reg.find((x) => x && x.super_identity_id === target_super_identity_id);
  const linked = Array.isArray(target?.linked_identities) ? target.linked_identities : [];
  const set = new Set(linked.map((x) => `${String(x?.channel)}:${String(x?.user_id)}`));
  for (const c of changes) {
    const k2 = `${c.channel}:${c.user_id}`;
    if (!set.has(k2)) linked.push({ channel: c.channel, user_id: c.user_id });
  }
  upsertSuperIdentity({ registry: reg, super_identity_id: target_super_identity_id, linked_identities: linked });

  saveLinks(linksPath, links);
  saveRegistry(registryPath, reg);

  appendMergeHistory(mergesPath, {
    ts: nowIso(),
    op: 'merge_identity',
    target_super_identity_id,
    changes
  });

  return { ok: true, merged: true, target_super_identity_id, changes };
}

export function inspectIdentityState({ dataDir } = {}) {
  const { registry: registryPath, links: linksPath, merges: mergesPath } = getIdentityPaths({ dataDir });

  const regDoc = loadRegistry(registryPath);
  const linksDoc = loadLinks(linksPath);
  const mergesDoc = safeReadJson(mergesPath);

  return {
    ok: true,
    registry: regDoc,
    links: linksDoc,
    merge_history: mergesDoc && isPlainObject(mergesDoc) ? mergesDoc : { ok: true, history: [] }
  };
}
