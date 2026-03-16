import { validateTask } from './taskSchema.mjs';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

export function buildTaskPublishedMessage({ task, from_peer_id } = {}) {
  const v = validateTask(task);
  if (!v.ok) return { ok: false, error: v.error };
  const from = safeStr(from_peer_id) || safeStr(task.created_by);
  return {
    ok: true,
    message: {
      kind: 'A2A_TASK_PUBLISHED',
      timestamp: new Date().toISOString(),
      from_peer_id: from,
      task
    }
  };
}

export function buildTaskResultMessage({ task_id, from_peer_id, to_peer_id, final_status, result, result_hash, error } = {}) {
  const tid = safeStr(task_id);
  if (!tid) return { ok: false, error: { code: 'MISSING_TASK_ID' } };
  return {
    ok: true,
    message: {
      kind: 'A2A_TASK_RESULT',
      timestamp: new Date().toISOString(),
      from_peer_id: safeStr(from_peer_id) || null,
      to_peer_id: safeStr(to_peer_id) || null,
      task_id: tid,
      final_status: safeStr(final_status) || null,
      result: result ?? null,
      result_hash: safeStr(result_hash) || null,
      error: error ?? null
    }
  };
}

export function buildTaskAcceptedMessage({ task_id, from_peer_id, to_peer_id, holder, lease_expires_at } = {}) {
  const tid = safeStr(task_id);
  if (!tid) return { ok: false, error: { code: 'MISSING_TASK_ID' } };
  return {
    ok: true,
    message: {
      kind: 'A2A_TASK_ACCEPTED',
      timestamp: new Date().toISOString(),
      from_peer_id: safeStr(from_peer_id) || null,
      to_peer_id: safeStr(to_peer_id) || null,
      task_id: tid,
      holder: safeStr(holder) || null,
      lease_expires_at: safeStr(lease_expires_at) || null
    }
  };
}
