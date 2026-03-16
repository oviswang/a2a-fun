import crypto from 'node:crypto';

export const TASK_TYPES = ['query', 'fetch', 'run_check'];
export const TASK_STATES = ['published', 'accepted', 'running', 'completed', 'failed', 'expired'];

export function nowIso() {
  return new Date().toISOString();
}

export function newTaskId() {
  return `task:${crypto.randomUUID()}`;
}

export function validateTask(task) {
  if (!task || typeof task !== 'object') return { ok: false, error: { code: 'INVALID_TASK' } };

  const required = ['task_id', 'type', 'topic', 'created_at', 'created_by', 'status', 'input', 'lease'];
  for (const k of required) {
    if (!(k in task)) return { ok: false, error: { code: 'MISSING_FIELD', field: k } };
  }

  if (!String(task.task_id || '').startsWith('task:')) return { ok: false, error: { code: 'INVALID_TASK_ID' } };
  if (!TASK_TYPES.includes(task.type)) return { ok: false, error: { code: 'INVALID_TYPE' } };
  if (!TASK_STATES.includes(task.status)) return { ok: false, error: { code: 'INVALID_STATUS' } };

  if (!task.lease || typeof task.lease !== 'object') return { ok: false, error: { code: 'INVALID_LEASE' } };

  return { ok: true };
}

export function createTask({ type, topic, created_by, input } = {}) {
  const t = {
    task_id: newTaskId(),
    type,
    topic: String(topic || '').trim(),
    created_at: nowIso(),
    created_by: String(created_by || '').trim(),
    assigned_to: null,
    status: 'published',
    input: input && typeof input === 'object' ? input : {},
    result: null,
    error: null,
    lease: {
      holder: null,
      expires_at: null
    }
  };

  const v = validateTask(t);
  if (!v.ok) return { ok: false, error: v.error };
  return { ok: true, task: t };
}
