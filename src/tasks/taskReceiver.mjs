import { publishTask, loadTasks, saveTasks, getTasksPath } from './taskStore.mjs';
import { validateTask } from './taskSchema.mjs';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

export async function receiveTaskPublished({ workspace_path, payload } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  if (!isObj(payload) || payload.kind !== 'A2A_TASK_PUBLISHED') return { ok: false, error: { code: 'INVALID_PAYLOAD' } };
  const task = payload.task;
  const v = validateTask(task);
  if (!v.ok) return { ok: false, error: v.error };

  // Store idempotently: if task_id already exists, ignore
  const tasks_path = getTasksPath({ workspace_path: ws });
  const loaded = await loadTasks({ tasks_path });
  if (loaded.table.tasks.some((t) => t.task_id === task.task_id)) {
    return { ok: true, deduped: true, task_id: task.task_id };
  }

  await publishTask({ tasks_path, task });
  console.log(JSON.stringify({ ok: true, event: 'A2A_TASK_PUBLISHED_RECEIVED', task_id: task.task_id, from: payload.from_peer_id || null }));
  return { ok: true, deduped: false, task_id: task.task_id };
}

export async function receiveTaskResult({ workspace_path, payload } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  if (!isObj(payload) || payload.kind !== 'A2A_TASK_RESULT') return { ok: false, error: { code: 'INVALID_PAYLOAD' } };

  const task_id = safeStr(payload.task_id);
  if (!task_id) return { ok: false, error: { code: 'MISSING_TASK_ID' } };

  const tasks_path = getTasksPath({ workspace_path: ws });
  const loaded = await loadTasks({ tasks_path });
  const t = loaded.table.tasks.find((x) => x.task_id === task_id) || null;
  if (!t) {
    // Store a minimal completed record if missing
    loaded.table.tasks.push({
      task_id,
      type: 'query',
      topic: 'unknown',
      created_at: payload.timestamp || new Date().toISOString(),
      created_by: payload.to_peer_id || 'unknown',
      assigned_to: payload.from_peer_id || null,
      status: payload.final_status || 'completed',
      input: {},
      result: payload.result ?? null,
      error: payload.error ?? null,
      lease: { holder: payload.from_peer_id || null, expires_at: null }
    });
  } else {
    t.status = payload.final_status || 'completed';
    t.result = payload.result ?? null;
    t.error = payload.error ?? null;
  }

  await saveTasks({ tasks_path, table: loaded.table });
  console.log(JSON.stringify({ ok: true, event: 'A2A_TASK_RESULT_RECEIVED', task_id, from: payload.from_peer_id || null }));
  return { ok: true, task_id };
}
