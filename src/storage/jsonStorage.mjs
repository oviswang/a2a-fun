import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

function nowIso() {
  return new Date().toISOString();
}

function sha256Hex(s) {
  return createHash('sha256').update(String(s), 'utf8').digest('hex');
}

function loadJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function atomicWriteJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${randomUUID()}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  writeFileSync(path, readFileSync(tmp));
}

/**
 * Phase 1 local storage using a single JSON file.
 *
 * Notes:
 * - Friends are keyed by peer_actor_id (no friend_id).
 * - peer_key_fpr is nullable in Phase 1.
 */
export class JsonFileStorage {
  /**
   * @param {{path: string}} opts
   */
  constructor(opts) {
    this.path = resolve(opts.path);
    this._db = null;
  }

  _ensureLoaded() {
    if (this._db) return;
    const existing = loadJson(this.path);
    this._db = existing ?? { friends: {}, sessions: {}, audit_logs: [] };
  }

  _flush() {
    atomicWriteJson(this.path, this._db);
  }

  // Friends
  upsertFriend(peer_actor_id, patch = {}) {
    this._ensureLoaded();
    if (!peer_actor_id) throw new Error('peer_actor_id required');
    const existing = this._db.friends[peer_actor_id] ?? {
      peer_actor_id,
      peer_key_fpr: null,
      created_at: nowIso(),
      last_seen_at: null,
      status: 'FRIEND',
      notes: null
    };

    const next = {
      ...existing,
      ...patch,
      peer_actor_id,
      peer_key_fpr: patch.peer_key_fpr ?? existing.peer_key_fpr ?? null
    };

    this._db.friends[peer_actor_id] = next;
    this._flush();
    return next;
  }

  getFriend(peer_actor_id) {
    this._ensureLoaded();
    return this._db.friends[peer_actor_id] ?? null;
  }

  setFriendStatus(peer_actor_id, status) {
    this._ensureLoaded();
    const rec = this._db.friends[peer_actor_id];
    if (!rec) throw new Error('friend not found');
    rec.status = status;
    this._flush();
  }

  // Sessions
  createSession(peer_actor_id) {
    this._ensureLoaded();
    const session_id = randomUUID();
    const rec = {
      session_id,
      peer_actor_id,
      state: 'DISCONNECTED',
      created_at: nowIso(),
      updated_at: nowIso(),
      probe_rounds_used: 0,
      probe_transcript_hash: null,
      local_entered: false,
      remote_entered: false,
      closed_reason: null
    };
    this._db.sessions[session_id] = rec;
    this._flush();
    return rec;
  }

  getSession(session_id) {
    this._ensureLoaded();
    return this._db.sessions[session_id] ?? null;
  }

  updateSession(session_id, patch) {
    this._ensureLoaded();
    const rec = this._db.sessions[session_id];
    if (!rec) throw new Error('session not found');
    const next = { ...rec, ...patch, session_id, updated_at: nowIso() };
    this._db.sessions[session_id] = next;
    this._flush();
    return next;
  }

  // Audit
  appendAuditLog(record) {
    this._ensureLoaded();
    if (!record || !record.session_id) throw new Error('audit record missing session_id');
    const log_id = record.log_id ?? randomUUID();
    const rec = {
      log_id,
      session_id: record.session_id,
      ts: record.ts ?? nowIso(),
      event_type: record.event_type,
      event_hash: record.event_hash ?? sha256Hex(JSON.stringify(record.preview_safe ?? {})),
      preview_safe: record.preview_safe ?? null
    };
    this._db.audit_logs.push(rec);
    this._flush();
  }

  listAuditLogs(session_id, limit = 50) {
    this._ensureLoaded();
    return this._db.audit_logs.filter(x => x.session_id === session_id).slice(-limit);
  }
}
