import { loadTasks, saveTasks, getTasksPath } from './taskStore.mjs';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

export function buildTaskAcceptedPayload({ task_id, holder, lease } = {}) {
  const tid = safeStr(task_id);
  const h = safeStr(holder);
  const exp = safeStr(lease?.expires_at);
  if (!tid || !h || !exp) return { ok: false, error: { code: 'MISSING_FIELDS' } };
  return {
    ok: true,
    payload: {
      kind: 'A2A_TASK_ACCEPTED',
      timestamp: new Date().toISOString(),
      task_id: tid,
      holder: h,
      lease: {
        holder: h,
        expires_at: exp
      }
    }
  };
}

export async function receiveTaskAccepted({ workspace_path, payload } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  if (!isObj(payload) || payload.kind !== 'A2A_TASK_ACCEPTED') return { ok: false, error: { code: 'INVALID_PAYLOAD' } };

  const task_id = safeStr(payload.task_id);
  const holder = safeStr(payload.holder);
  const expires_at = safeStr(payload.lease?.expires_at);
  if (!task_id || !holder || !expires_at) return { ok: false, error: { code: 'MISSING_FIELDS' } };

  const tasks_path = getTasksPath({ workspace_path: ws });
  const loaded = await loadTasks({ tasks_path });
  const t = loaded.table.tasks.find((x) => x.task_id === task_id) || null;

  console.log(JSON.stringify({ ok: true, event: 'A2A_TASK_ACCEPTED_RECEIVED', task_id, holder, expires_at }));

  if (!t) {
    // No local task record: create a minimal accepted placeholder
    loaded.table.tasks.push({
      task_id,
      type: 'query',
      topic: 'unknown',
      created_at: payload.timestamp || new Date().toISOString(),
      created_by: 'unknown',
      assigned_to: holder,
      status: 'accepted',
      input: {},
      requires: null,
      fingerprint: null,
      result: null,
      result_hash: null,
      error: null,
      lease: { holder, expires_at }
    });
    await saveTasks({ tasks_path, table: loaded.table });
    return { ok: true, task_id, applied: true };
  }

  // Conflict rule: keep completed result
  if (t.status === 'completed') {
    console.log(JSON.stringify({ ok: true, event: 'TASK_CLAIM_LATE_COMPLETED_LOCAL', task_id, local_holder: t.assigned_to || null, incoming_holder: holder }));
    return { ok: true, task_id, applied: false, reason: 'local_completed' };
  }

  // Apply if local is not stronger
  t.assigned_to = holder;
  if (t.status === 'running') {
    // keep running only if this node is the holder
    if (safeStr(t.lease?.holder) !== holder) {
      t.status = 'accepted';
    }
  } else {
    t.status = 'accepted';
  }
  t.lease = { holder, expires_at };

  await saveTasks({ tasks_path, table: loaded.table });
  return { ok: true, task_id, applied: true };
}
