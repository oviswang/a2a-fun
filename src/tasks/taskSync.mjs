import { loadTasks, saveTasks, getTasksPath } from './taskStore.mjs';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function statusRank(status) {
  // monotonic-ish ordering for merge
  const order = {
    published: 1,
    accepted: 2,
    running: 3,
    completed: 4,
    failed: 4,
    expired: 0
  };
  return order[String(status || '')] || 0;
}

export async function mergeTasksIntoStore({ workspace_path, tasks } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  const tasks_path = getTasksPath({ workspace_path: ws });
  const loaded = await loadTasks({ tasks_path });

  const local = loaded.table.tasks;
  const byId = new Map(local.map((t) => [t.task_id, t]));

  let inserted = 0;
  let updated = 0;

  for (const incoming of Array.isArray(tasks) ? tasks : []) {
    if (!incoming || typeof incoming !== 'object') continue;
    const id = safeStr(incoming.task_id);
    if (!id) continue;

    const cur = byId.get(id);
    if (!cur) {
      local.push(incoming);
      byId.set(id, incoming);
      inserted++;
      continue;
    }

    const curRank = statusRank(cur.status);
    const inRank = statusRank(incoming.status);

    // do not overwrite completed/failed with older states
    if (curRank >= 4 && inRank < 4) continue;

    // update if incoming is "newer" by rank or created_at
    if (inRank > curRank) {
      Object.assign(cur, incoming);
      updated++;
      continue;
    }

    // tie: prefer later updated_at/created_at if present
    const curTs = Date.parse(cur.updated_at || cur.created_at || '');
    const inTs = Date.parse(incoming.updated_at || incoming.created_at || '');
    if (Number.isFinite(inTs) && Number.isFinite(curTs) && inTs > curTs) {
      Object.assign(cur, incoming);
      updated++;
    }
  }

  loaded.table.tasks = local;
  await saveTasks({ tasks_path, table: loaded.table });

  return { ok: true, tasks_path, inserted, updated, total: local.length };
}

export function buildTaskSyncRequest({ node_id, limit = 50 } = {}) {
  const nid = safeStr(node_id);
  return {
    ok: true,
    message: {
      kind: 'A2A_TASK_SYNC_REQUEST',
      timestamp: new Date().toISOString(),
      node_id: nid || null,
      limit: Math.max(1, Math.min(200, Number(limit) || 50))
    }
  };
}

export async function buildTaskSyncResponse({ workspace_path, limit = 50 } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  const tasks_path = getTasksPath({ workspace_path: ws });
  const loaded = await loadTasks({ tasks_path });

  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const tasks = [...loaded.table.tasks]
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, lim);

  return {
    ok: true,
    message: {
      kind: 'A2A_TASK_SYNC_RESPONSE',
      timestamp: new Date().toISOString(),
      tasks
    }
  };
}

export async function receiveTaskSyncRequest({ workspace_path, payload } = {}) {
  if (!isObj(payload) || payload.kind !== 'A2A_TASK_SYNC_REQUEST') return { ok: false, error: { code: 'INVALID_PAYLOAD' } };
  const limit = payload.limit || 50;
  const res = await buildTaskSyncResponse({ workspace_path, limit });
  console.log(JSON.stringify({ ok: true, event: 'A2A_TASK_SYNC_REQUEST_RECEIVED', limit: res.message.tasks.length }));
  return { ok: true, response: res.message };
}

export async function receiveTaskSyncResponse({ workspace_path, payload } = {}) {
  if (!isObj(payload) || payload.kind !== 'A2A_TASK_SYNC_RESPONSE') return { ok: false, error: { code: 'INVALID_PAYLOAD' } };
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  const out = await mergeTasksIntoStore({ workspace_path, tasks });
  console.log(JSON.stringify({ ok: true, event: 'A2A_TASK_SYNC_RESPONSE_APPLIED', inserted: out.inserted, updated: out.updated, total: out.total }));
  return { ok: true, ...out };
}
