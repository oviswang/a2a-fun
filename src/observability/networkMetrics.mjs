import fs from 'node:fs/promises';

import { buildNetworkSnapshot } from './networkSnapshot.mjs';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function toNum(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

function pct(n, d) {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return 0;
  return n / d;
}

function parseIso(s) {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

function countBy(arr, keyFn) {
  const out = {};
  for (const x of arr) {
    const k = keyFn(x);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

export async function buildNetworkMetrics({ workspace_path, active_window_seconds = 600 } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();

  const snap = await buildNetworkSnapshot({ workspace_path: ws });
  const s = snap.snapshot;

  const completed = toNum(s?.tasks?.counts_by_status?.completed, 0);
  const failed = toNum(s?.tasks?.counts_by_status?.failed, 0);
  const total_done = completed + failed;
  const success_rate = pct(completed, total_done);

  const nodes_total = toNum(s?.nodes_total, 0);
  const nodes_online = toNum(s?.nodes_online, 0);

  const now = Date.now();
  const windowMs = toNum(active_window_seconds, 600) * 1000;
  const nodes_active_recently = Array.isArray(s?.peers)
    ? s.peers.filter((p) => {
        const t = parseIso(p?.stats?.last_task_at) || parseIso(p?.liveness?.last_seen);
        return t && now - t <= windowMs;
      }).length
    : 0;

  // Best-effort counters from runtime_state if present
  const recovery_events_total = toNum(s?.recovery?.counters?.total, 0);
  const duplicate_result_ignored_total = toNum(s?.runtime_state?.duplicate_result_ignored_total, 0);

  // Best-effort: scheduler selections by node.
  // We try runtime_state.scheduler_selections_by_node first; otherwise compute from task history (assigned_to on completed tasks).
  let scheduler_selections_by_node = s?.scheduler?.recent_selection?.selections_by_node || s?.runtime_state?.scheduler_selections_by_node || null;

  if (!scheduler_selections_by_node) {
    try {
      const tasks_path = safeStr(s?.sources?.tasks_path);
      const table = await readJson(tasks_path);
      const tasks = Array.isArray(table?.tasks) ? table.tasks : [];
      const completedTasks = tasks.filter((t) => safeStr(t?.status) === 'completed');
      const by = countBy(completedTasks, (t) => safeStr(t?.assigned_to) || 'unknown');
      scheduler_selections_by_node = by;
    } catch {
      scheduler_selections_by_node = {};
    }
  }

  const metrics = {
    ok: true,
    kind: 'NETWORK_METRICS_V0_1',
    timestamp: new Date().toISOString(),
    workspace_path: ws,
    active_window_seconds: toNum(active_window_seconds, 600),

    tasks_completed_total: completed,
    tasks_failed_total: failed,
    success_rate,

    nodes_total,
    nodes_online,
    nodes_active_recently,

    recovery_events_total,
    duplicate_result_ignored_total,

    scheduler_selections_by_node,

    errors: {
      snapshot: snap.ok ? null : snap.error || { code: 'SNAPSHOT_FAILED' }
    }
  };

  return { ok: true, metrics };
}
