import { buildNetworkMetrics } from './networkMetrics.mjs';

function toNum(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

function safeObj(x) {
  return x && typeof x === 'object' && !Array.isArray(x) ? x : {};
}

function sortedCounts(obj) {
  const entries = Object.entries(safeObj(obj)).map(([k, v]) => [k, toNum(v, 0)]);
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries;
}

export async function buildNetworkAutotune({ workspace_path, metrics } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();

  const m = metrics || (await buildNetworkMetrics({ workspace_path: ws })).metrics;

  const recs = [];

  // Scheduler fairness: concentration check
  const sel = safeObj(m.scheduler_selections_by_node);
  const counts = sortedCounts(sel);
  const total = counts.reduce((s, [, v]) => s + v, 0);
  const top = counts[0] || null;
  const topShare = total > 0 && top ? top[1] / total : 0;

  if (total >= 5 && topShare >= 0.7) {
    recs.push({
      area: 'scheduler_fairness',
      level: 'warn',
      rule_id: 'SCHED_CONCENTRATION_HIGH',
      evidence: { total_selections: total, top_node: top[0], top_count: top[1], top_share: topShare },
      recommendation: {
        action: 'rebalance_scheduler',
        notes: 'One node is receiving a large share of scheduled work. Consider adding tie-break jitter, using last_task_at recency, or a moving-average load metric.'
      }
    });
  } else {
    recs.push({
      area: 'scheduler_fairness',
      level: 'ok',
      rule_id: 'SCHED_CONCENTRATION_OK',
      evidence: { total_selections: total, top_share: topShare },
      recommendation: { action: 'no_change', notes: 'No strong skew detected (or insufficient history).' }
    });
  }

  // Lease timeout sensitivity: recovery pressure
  const recovery = toNum(m.recovery_events_total, 0);
  if (recovery >= 5) {
    recs.push({
      area: 'lease_timeout_sensitivity',
      level: 'warn',
      rule_id: 'RECOVERY_EVENTS_HIGH',
      evidence: { recovery_events_total: recovery },
      recommendation: {
        action: 'review_lease_timeout',
        notes: 'High recovery events suggests leases may be expiring too aggressively (or nodes are unstable). Consider increasing lease duration or improving heartbeat/tick reliability.'
      }
    });
  } else {
    recs.push({
      area: 'lease_timeout_sensitivity',
      level: 'ok',
      rule_id: 'RECOVERY_EVENTS_OK',
      evidence: { recovery_events_total: recovery },
      recommendation: { action: 'no_change', notes: 'Recovery event volume is low.' }
    });
  }

  // Task sync cadence + peer gossip cadence: online stability proxy
  // We only have current snapshot metrics (no time series). Use heuristics:
  // - if nodes_online/nodes_total is high -> keep
  // - if low -> recommend shorter intervals
  const nodes_total = toNum(m.nodes_total, 0);
  const nodes_online = toNum(m.nodes_online, 0);
  const onlineRatio = nodes_total > 0 ? nodes_online / nodes_total : 0;

  if (nodes_total >= 3 && onlineRatio < 0.7) {
    recs.push({
      area: 'task_sync_cadence',
      level: 'warn',
      rule_id: 'ONLINE_RATIO_LOW',
      evidence: { nodes_total, nodes_online, online_ratio: onlineRatio },
      recommendation: { action: 'shorten_task_sync_interval', notes: 'Many nodes appear offline; shorter task sync can reduce divergence after restarts.' }
    });
    recs.push({
      area: 'peer_gossip_cadence',
      level: 'warn',
      rule_id: 'ONLINE_RATIO_LOW',
      evidence: { nodes_total, nodes_online, online_ratio: onlineRatio },
      recommendation: { action: 'shorten_peer_gossip_interval', notes: 'Many nodes appear offline; more frequent gossip can speed peer table convergence after churn.' }
    });
  } else {
    recs.push({
      area: 'task_sync_cadence',
      level: 'ok',
      rule_id: 'ONLINE_RATIO_OK',
      evidence: { nodes_total, nodes_online, online_ratio: onlineRatio },
      recommendation: { action: 'keep_current', notes: 'Online ratio looks healthy; keep current task sync interval.' }
    });
    recs.push({
      area: 'peer_gossip_cadence',
      level: 'ok',
      rule_id: 'ONLINE_RATIO_OK',
      evidence: { nodes_total, nodes_online, online_ratio: onlineRatio },
      recommendation: { action: 'keep_current', notes: 'Online ratio looks healthy; keep current peer gossip interval.' }
    });
  }

  const output = {
    ok: true,
    kind: 'NETWORK_AUTOTUNE_V0_1',
    timestamp: new Date().toISOString(),
    workspace_path: ws,
    inputs: {
      metrics_kind: m.kind || null,
      metrics_timestamp: m.timestamp || null
    },
    recommendations: recs
  };

  return { ok: true, autotune: output };
}
