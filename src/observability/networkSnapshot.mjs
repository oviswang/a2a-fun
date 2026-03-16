import { getPeersPath, loadPeers } from '../peers/peerStore.mjs';
import { getTasksPath, loadTasks } from '../tasks/taskStore.mjs';
import { loadRuntimeState, getRuntimeStatePath } from '../runtime/agentRuntimeLoop.mjs';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function toNum(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

function countBy(arr, fn) {
  const out = {};
  for (const x of arr) {
    const k = fn(x);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

export async function buildNetworkSnapshot({ workspace_path } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();

  const peers_path = getPeersPath({ workspace_path: ws });
  const tasks_path = getTasksPath({ workspace_path: ws });
  const runtime_state_path = getRuntimeStatePath({ workspace_path: ws });

  const peersLoaded = await loadPeers({ peers_path }).catch((e) => ({ ok: false, error: { message: String(e?.message || e) }, table: { peers: [] } }));
  const tasksLoaded = await loadTasks({ tasks_path }).catch((e) => ({ ok: false, error: { message: String(e?.message || e) }, table: { tasks: [] } }));
  const runtimeLoaded = await loadRuntimeState({ state_path: runtime_state_path }).catch((e) => ({ ok: false, error: { message: String(e?.message || e) }, state: {} }));

  const peers = Array.isArray(peersLoaded.table?.peers) ? peersLoaded.table.peers : [];
  const tasks = Array.isArray(tasksLoaded.table?.tasks) ? tasksLoaded.table.tasks : [];
  const state = runtimeLoaded.state && typeof runtimeLoaded.state === 'object' ? runtimeLoaded.state : {};

  const nodes_total = peers.length;
  const nodes_online = peers.filter((p) => !!p?.liveness?.on_relay).length;

  const peers_basic = peers
    .map((p) => ({
      node_id: safeStr(p?.peer_id),
      relay: safeStr(p?.endpoints?.relay_url) || null,
      last_seen: safeStr(p?.liveness?.last_seen) || null,
      liveness: {
        on_relay: !!p?.liveness?.on_relay,
        last_seen: safeStr(p?.liveness?.last_seen) || null
      },
      capabilities: Array.isArray(p?.capabilities?.skills) ? p.capabilities.skills : [],
      stats: {
        tasks_executed: toNum(p?.stats?.tasks_executed, 0),
        last_task_at: safeStr(p?.stats?.last_task_at) || null
      }
    }))
    .filter((p) => p.node_id)
    .sort((a, b) => a.node_id.localeCompare(b.node_id))
    .slice(0, 100);

  const task_counts_by_status = countBy(tasks, (t) => safeStr(t?.status) || 'unknown');

  // Recent scheduler selection info (best-effort): stored in runtime_state if present.
  // We don't redesign runtime: just surface any fields already present.
  const scheduler_recent = state.last_scheduler_selection || state.scheduler_recent || null;

  // Recent recovery counters (best-effort): surface if present.
  const recovery_counters = state.recovery_counters || state.task_recovery_counters || null;

  const snapshot = {
    ok: true,
    kind: 'NETWORK_SNAPSHOT_V1',
    timestamp: new Date().toISOString(),
    workspace_path: ws,
    sources: {
      peers_path,
      tasks_path,
      runtime_state_path
    },
    nodes_total,
    nodes_online,
    peers: peers_basic,
    tasks: {
      total: tasks.length,
      counts_by_status: task_counts_by_status
    },
    runtime_state: {
      current_mode: safeStr(state.current_mode) || null,
      last_loop_tick_at: safeStr(state.last_loop_tick_at) || null
    },
    scheduler: {
      recent_selection: scheduler_recent
    },
    recovery: {
      counters: recovery_counters
    },
    errors: {
      peers: peersLoaded.ok ? null : peersLoaded.error || { code: 'LOAD_PEERS_FAILED' },
      tasks: tasksLoaded.ok ? null : tasksLoaded.error || { code: 'LOAD_TASKS_FAILED' },
      runtime_state: runtimeLoaded.ok ? null : runtimeLoaded.error || { code: 'LOAD_RUNTIME_STATE_FAILED' }
    }
  };

  return { ok: true, snapshot };
}
