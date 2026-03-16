import fs from 'node:fs/promises';
import path from 'node:path';

import { validateTask, nowIso } from './taskSchema.mjs';

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

async function writeJsonAtomic(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, p);
}

export function getTasksPath({ workspace_path } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  return path.join(ws, 'data', 'tasks.json');
}

export async function loadTasks({ tasks_path } = {}) {
  try {
    const obj = await readJson(tasks_path);
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.tasks)) {
      return { ok: true, tasks_path, table: { ok: true, version: 'tasks.v0.1', updated_at: null, tasks: [] } };
    }
    return { ok: true, tasks_path, table: obj };
  } catch {
    return { ok: true, tasks_path, table: { ok: true, version: 'tasks.v0.1', updated_at: null, tasks: [] } };
  }
}

export async function saveTasks({ tasks_path, table } = {}) {
  const t = table && typeof table === 'object' ? table : { ok: true, version: 'tasks.v0.1', updated_at: null, tasks: [] };
  t.updated_at = nowIso();
  await writeJsonAtomic(tasks_path, t);
  return { ok: true, tasks_path };
}

export async function publishTask({ tasks_path, task } = {}) {
  const v = validateTask(task);
  if (!v.ok) return { ok: false, error: v.error };

  const loaded = await loadTasks({ tasks_path });
  const tasks = loaded.table.tasks;
  tasks.push(task);
  loaded.table.tasks = tasks;
  await saveTasks({ tasks_path, table: loaded.table });
  return { ok: true, task_id: task.task_id };
}

export async function acceptTask({ tasks_path, task_id, holder, lease_seconds = 60 } = {}) {
  const loaded = await loadTasks({ tasks_path });
  const tasks = loaded.table.tasks;
  const t = tasks.find((x) => x.task_id === task_id) || null;
  if (!t) return { ok: false, error: { code: 'TASK_NOT_FOUND' } };
  if (t.status !== 'published') return { ok: false, error: { code: 'TASK_NOT_PUBLISHABLE', status: t.status } };

  t.status = 'accepted';
  t.assigned_to = String(holder || '').trim() || null;
  t.lease.holder = t.assigned_to;
  t.lease.expires_at = new Date(Date.now() + lease_seconds * 1000).toISOString();

  await saveTasks({ tasks_path, table: loaded.table });
  return { ok: true, task_id };
}

export async function markRunning({ tasks_path, task_id } = {}) {
  const loaded = await loadTasks({ tasks_path });
  const t = loaded.table.tasks.find((x) => x.task_id === task_id) || null;
  if (!t) return { ok: false, error: { code: 'TASK_NOT_FOUND' } };
  if (t.status !== 'accepted') return { ok: false, error: { code: 'TASK_NOT_ACCEPTED', status: t.status } };
  t.status = 'running';
  await saveTasks({ tasks_path, table: loaded.table });
  return { ok: true, task_id };
}

export async function completeTask({ tasks_path, task_id, result } = {}) {
  const loaded = await loadTasks({ tasks_path });
  const t = loaded.table.tasks.find((x) => x.task_id === task_id) || null;
  if (!t) return { ok: false, error: { code: 'TASK_NOT_FOUND' } };
  t.status = 'completed';
  t.result = result ?? null;
  t.error = null;
  await saveTasks({ tasks_path, table: loaded.table });
  return { ok: true, task_id };
}

export async function failTask({ tasks_path, task_id, error } = {}) {
  const loaded = await loadTasks({ tasks_path });
  const t = loaded.table.tasks.find((x) => x.task_id === task_id) || null;
  if (!t) return { ok: false, error: { code: 'TASK_NOT_FOUND' } };
  t.status = 'failed';
  t.error = error && typeof error === 'object' ? error : { code: 'FAILED' };
  await saveTasks({ tasks_path, table: loaded.table });
  return { ok: true, task_id };
}
