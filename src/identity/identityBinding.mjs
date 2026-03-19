import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function safeReadText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function atomicWriteJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

export function loadNodeId({ dataDir } = {}) {
  const dir = dataDir || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'data');
  const p = path.join(dir, 'node_id');
  const txt = safeReadText(p);
  const id = (txt || '').trim();
  return id || null;
}

/**
 * Fixes SELF_ID_UNKNOWN by ensuring a stable local agent id.
 * Precedence:
 * 1) data/a2a_agent_id (explicit)
 * 2) derive from node_id
 */
export function loadLocalAgentId({ dataDir } = {}) {
  const dir = dataDir || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'data');
  const explicit = (safeReadText(path.join(dir, 'a2a_agent_id')) || '').trim();
  if (explicit) return explicit;

  const node_id = loadNodeId({ dataDir: dir });
  if (!node_id) return null;
  return `agent:${node_id}`;
}

/**
 * Map a channel user to an A2A agent id.
 * Stored at data/channel_user_agent_map.json
 */
export function bindChannelUserToAgentId({ channel, user_id, dataDir } = {}) {
  const dir = dataDir || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'data');
  const p = path.join(dir, 'channel_user_agent_map.json');

  let j = {};
  try {
    const raw = safeReadText(p);
    j = raw ? JSON.parse(raw) : {};
  } catch {
    j = {};
  }
  if (!isPlainObject(j)) j = {};

  const key = `${String(channel)}:${String(user_id)}`;
  if (typeof j[key] === 'string' && j[key]) {
    return { ok: true, agent_id: j[key], created: false };
  }

  const local_agent_id = loadLocalAgentId({ dataDir: dir }) || 'agent:unknown';
  const derived = `a2a:${sha256Hex(`${local_agent_id}|${key}`).slice(0, 24)}`;
  j[key] = derived;
  atomicWriteJson(p, j);
  return { ok: true, agent_id: derived, created: true };
}
