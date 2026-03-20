#!/usr/bin/env node

// A2A v0.6.5 (observability-only)
// Lightweight derived network observability report. No routing / reward / settlement / evolution changes.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { getNetworkSnapshot } from '../src/runtime/network/networkSnapshotV0_1.mjs';
import { getNormalizedVersionInfo } from '../src/runtime/versionInfo.mjs';

import { rebuildMarketMetrics } from '../src/market/offerFeed.mjs';
import { rebuildStrategyProfiles } from '../src/analytics/strategyCompetition.mjs';
import { rebuildLearningInsights } from '../src/analytics/learningNetwork.mjs';

function nowIso() {
  return new Date().toISOString();
}

function safeStr(v) {
  return typeof v === 'string' ? v.trim() : '';
}

async function readJsonSafe(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(String(raw || ''));
  } catch {
    return null;
  }
}

function tryExec(cmd) {
  try {
    return String(execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] })).trim();
  } catch {
    return '';
  }
}

function normalizeGitDescribeVersion(v) {
  const s = safeStr(v);
  if (!s) return null;
  // Normalize: v0.6.4-stable-1-g40433b9 -> v0.6.4-stable
  const m = /^(v\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+)?)(?:-\d+-g[0-9a-f]+)?$/.exec(s);
  if (m) return m[1];
  return s;
}

function isActiveTs(tsIso, windowMs) {
  try {
    const t = Date.parse(String(tsIso));
    if (!Number.isFinite(t)) return false;
    return Date.now() - t <= windowMs;
  } catch {
    return false;
  }
}

function avg(xs) {
  const ys = xs.filter((x) => Number.isFinite(x));
  if (!ys.length) return 0;
  return ys.reduce((a, b) => a + b, 0) / ys.length;
}

function classifyHealth({ daemon_alive, relay_connected, relay_registered, keepalive_enabled, peers_visible, snapshot_ok }) {
  const d = daemon_alive === true;
  if (!d) return 'offline';

  const relayOk = relay_registered === true && relay_connected === true;
  const peersOk = Number(peers_visible || 0) > 0;
  const snapOk = snapshot_ok === true;

  if (relayOk && peersOk && snapOk) return 'healthy';
  if (relay_registered === false) return 'degraded';
  if (!peersOk) return 'degraded';
  return 'partial';
}

function detectRisks({ version_distribution, health_distribution, market_activity, reward_activity, strategy_distribution, learning_activity }) {
  const risks = [];

  // Mixed-version network
  const vd = version_distribution || {};
  const versions = Object.keys(vd).filter((k) => k !== 'unknown' && vd[k] > 0);
  if (versions.length >= 2) {
    risks.push({ code: 'MIXED_VERSION_NETWORK', detail: { versions, version_distribution: vd } });
  }

  // High degraded/offline ratio
  const hd = health_distribution || {};
  const total = Object.values(hd).reduce((a, b) => a + (Number(b) || 0), 0) || 0;
  const bad = (Number(hd.degraded) || 0) + (Number(hd.offline) || 0);
  if (total > 0 && bad / total >= 0.5) {
    risks.push({ code: 'HIGH_DEGRADED_OFFLINE_RATIO', detail: { degraded_offline: bad, total, health_distribution: hd } });
  }

  // Market stalled
  const execCount = Number(market_activity?.offers_executed || 0);
  const offerCount = Number(market_activity?.offers_created || 0);
  if (offerCount > 0 && execCount === 0) {
    risks.push({ code: 'MARKET_STALLED', detail: { offers_created: offerCount, offers_executed: execCount } });
  }

  // Reward stalled
  const rewardCredits = Number(reward_activity?.reward_credits_count || 0);
  if (offerCount > 0 && rewardCredits === 0) {
    risks.push({ code: 'REWARD_STALLED', detail: { offers_created: offerCount, reward_credits_count: rewardCredits } });
  }

  // Imitation degrading (best-effort: if we have eval outcome counts)
  const evals = Number(learning_activity?.imitation_evaluation_count || 0);
  const degraded = Number(learning_activity?.degraded_count || 0);
  const improved = Number(learning_activity?.improved_count || 0);
  if (evals > 0 && degraded > improved) {
    risks.push({ code: 'IMITATION_MOSTLY_DEGRADING', detail: { evaluations: evals, improved, degraded } });
  }

  // Strategy over-convergence
  const byType = strategy_distribution?.by_strategy_type || {};
  const totalProfiles = Object.values(byType).reduce((a, b) => a + (Number(b?.count) || 0), 0) || 0;
  if (totalProfiles > 0) {
    const maxShare = Math.max(...Object.values(byType).map((x) => (Number(x?.count) || 0) / totalProfiles));
    if (maxShare >= 0.8) {
      const dominant = Object.entries(byType).sort((a, b) => (Number(b[1]?.count) || 0) - (Number(a[1]?.count) || 0))[0]?.[0] || 'unknown';
      risks.push({ code: 'STRATEGY_OVER_CONVERGENCE', detail: { dominant, max_share: maxShare, total_profiles: totalProfiles } });
    }
  }

  return risks;
}

function humanPrint(report, { mode = 'overview' } = {}) {
  const lines = [];
  const o = report.network_overview || {};

  lines.push('A2A Network Observability (v0.6.5)');
  lines.push(`- generated_at: ${report.generated_at}`);
  lines.push(`- self_node_id: ${o.self_node_id || 'unknown'}`);
  lines.push(`- peers_visible: ${o.peers_visible ?? 'n/a'}`);

  if (mode === 'overview' || mode === 'versions') {
    const vd = report.version_distribution || {};
    lines.push('Version distribution:');
    for (const [k, v] of Object.entries(vd).sort((a, b) => b[1] - a[1])) lines.push(`- ${k}: ${v}`);
  }

  if (mode === 'overview' || mode === 'health') {
    const hd = report.health_distribution || {};
    lines.push('Health distribution:');
    for (const [k, v] of Object.entries(hd).sort((a, b) => b[1] - a[1])) lines.push(`- ${k}: ${v}`);
  }

  if (mode === 'overview' || mode === 'market') {
    const m = report.market_activity || {};
    lines.push('Market activity:');
    lines.push(`- offers_created: ${m.offers_created ?? 0}`);
    lines.push(`- offers_accepted: ${m.offers_accepted ?? 0}`);
    lines.push(`- offers_rejected: ${m.offers_rejected ?? 0}`);
    lines.push(`- offers_executed: ${m.offers_executed ?? 0}`);
    lines.push(`- accept_rate: ${m.accept_rate ?? 0}`);
    lines.push(`- avg_expected_value: ${m.avg_expected_value ?? 0}`);
  }

  if (mode === 'overview' || mode === 'strategy') {
    const s = report.strategy_distribution || {};
    lines.push('Strategy distribution:');
    for (const [k, v] of Object.entries(s.by_strategy_type || {}).sort((a, b) => (Number(b[1]?.count)||0) - (Number(a[1]?.count)||0))) {
      lines.push(`- ${k}: count=${v.count} avg_threshold=${(v.avg_threshold ?? 0).toFixed?.(2) ?? v.avg_threshold}`);
    }
  }

  if (mode === 'overview' || mode === 'learning') {
    const l = report.learning_activity || {};
    lines.push('Learning activity:');
    lines.push(`- imitation_reference_count: ${l.imitation_reference_count ?? 0}`);
    lines.push(`- imitation_evaluation_count: ${l.imitation_evaluation_count ?? 0}`);
    lines.push(`- most_imitated_strategy_type: ${l.most_imitated_strategy_type ?? 'n/a'}`);
  }

  if (report.risks?.length) {
    lines.push('Risks:');
    for (const r of report.risks) lines.push(`- ${r.code}`);
  } else {
    lines.push('Risks: (none detected)');
  }

  lines.push(report.summary || '');

  process.stdout.write(lines.filter(Boolean).join('\n') + '\n');
}

function withSilencedConsole(fn) {
  const orig = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    stdoutWrite: process.stdout.write
  };

  // Keep stderr errors visible; silence stdout + log/info/warn.
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  // eslint-disable-next-line no-empty-function
  process.stdout.write = () => true;

  try {
    return fn();
  } finally {
    console.log = orig.log;
    console.info = orig.info;
    console.warn = orig.warn;
    console.error = orig.error;
    process.stdout.write = orig.stdoutWrite;
  }
}

function parseArgs(argv) {
  const out = {
    mode: 'overview',
    human: false,
    writeCache: false,
    service: process.env.A2A_DAEMON_SERVICE || 'a2a-fun-daemon.service'
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') out.mode = String(argv[++i] || 'overview');
    else if (a === '--human') out.human = true;
    else if (a === '--write-cache') out.writeCache = true;
    else if (a === '--service') out.service = String(argv[++i] || out.service);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const ws = process.env.A2A_WORKSPACE_PATH ? String(process.env.A2A_WORKSPACE_PATH).trim() : process.cwd();

  // -------------------
  // Local self version (normalized)
  // -------------------
  const selfVer = await getNormalizedVersionInfo({ workspace_path: ws });

  // -------------------
  // Presence cache (peer-observed)
  // -------------------
  const presence = await readJsonSafe(path.join(ws, 'data', 'presence-cache.json'));
  const peersObj = presence?.peers && typeof presence.peers === 'object' ? presence.peers : {};
  const peers = Object.values(peersObj).filter((p) => p && typeof p === 'object');

  const activeWindowMs = Number(process.env.PRESENCE_ACTIVE_WINDOW_MS || 120_000);
  const peersActive = peers.filter((p) => isActiveTs(p.last_presence_ts, activeWindowMs));

  // -------------------
  // Version distribution (derived from presence-cache + self)
  // -------------------
  const versionRows = [];
  for (const p of peers) {
    const node_id = safeStr(p.peer_id || p.node_id);
    if (!node_id) continue;
    const current_version = p.version ? safeStr(p.version) : null;
    versionRows.push({
      node_id,
      current_version,
      normalized_release_tag: current_version ? normalizeGitDescribeVersion(current_version) : 'unknown',
      release_version: null,
      version_source: current_version ? 'presence_cache' : 'unknown'
    });
  }
  versionRows.push({
    node_id: safeStr(process.env.NODE_ID || '') || safeStr(process.env.A2A_AGENT_ID || '') || 'self',
    current_version: selfVer.current_version,
    normalized_release_tag: normalizeGitDescribeVersion(selfVer.current_version) || 'unknown',
    release_version: selfVer.release_version,
    version_source: selfVer.version_source
  });

  const version_distribution = {};
  for (const r of versionRows) {
    const k = r.normalized_release_tag || 'unknown';
    version_distribution[k] = (version_distribution[k] || 0) + 1;
  }

  // -------------------
  // Health (best-effort)
  // -------------------
  const daemonAliveTxt = tryExec(`systemctl is-active ${args.service}`);
  const daemon_alive = daemonAliveTxt === 'active';

  const pidTxt = tryExec(`systemctl show -p MainPID --value ${args.service}`);
  const pid = pidTxt && /^\d+$/.test(pidTxt) ? Number(pidTxt) : null;

  let relay_connected = null;
  let relay_registered = null;
  let keepalive_enabled = null;

  if (pid) {
    const lines = tryExec(`journalctl _PID=${pid} -n 200 --no-pager`).split('\n').filter(Boolean);
    // We infer from recent send attempts; degrade gracefully.
    let sawWsReady = false;
    let sawRegistered = false;
    for (const line of lines) {
      const m = /\{.*\}/.exec(line);
      if (!m) continue;
      let j;
      try {
        j = JSON.parse(m[0]);
      } catch {
        continue;
      }
      if (j?.event === 'RELAY_SEND_ATTEMPT') {
        if (j.ws_ready_state === 1) sawWsReady = true;
        if (j.relay_registered === true) sawRegistered = true;
      }
    }
    relay_connected = sawWsReady;
    relay_registered = sawRegistered;
    // keepalive events may not exist in current build; treat as unknown unless explicitly seen.
    keepalive_enabled = null;
  }

  let snapshot_ok = false;
  let snapshot = null;
  try {
    snapshot = await getNetworkSnapshot({ workspace_path: ws });
    snapshot_ok = !!snapshot?.ok;
  } catch {
    snapshot_ok = false;
  }

  const peers_visible = peers.length;

  // Per-node health classification: only self is meaningful; peers are observational.
  const self_health = classifyHealth({
    daemon_alive,
    relay_connected,
    relay_registered,
    keepalive_enabled,
    peers_visible,
    snapshot_ok
  });

  const healthRows = [];
  healthRows.push({ node_id: versionRows[versionRows.length - 1].node_id, health: self_health });
  for (const p of peers) {
    const node_id = safeStr(p.peer_id || p.node_id);
    if (!node_id) continue;
    const seenActive = isActiveTs(p.last_presence_ts, activeWindowMs);
    // Only observational classification.
    healthRows.push({ node_id, health: seenActive ? 'partial' : 'offline' });
  }

  const health_distribution = { healthy: 0, partial: 0, degraded: 0, offline: 0, unknown: 0 };
  for (const r of healthRows) {
    const k = r.health in health_distribution ? r.health : 'unknown';
    health_distribution[k]++;
  }

  // -------------------
  // Market
  // -------------------
  let market_activity = {
    offers_created: 0,
    offers_accepted: 0,
    offers_rejected: 0,
    offers_executed: 0,
    accept_rate: 0,
    avg_expected_value: 0
  };
  try {
    const m = withSilencedConsole(() => rebuildMarketMetrics());
    const x = m.metrics || {};
    market_activity = {
      offers_created: Number(x.total_offers || 0),
      offers_accepted: Number(x.accepted_offers || 0),
      offers_rejected: Number(x.rejected_offers || 0),
      offers_executed: Number(x.executed_offers || 0),
      accept_rate: Number.isFinite(x.accept_rate) ? x.accept_rate : 0,
      avg_expected_value: Number.isFinite(x.avg_expected_value) ? x.avg_expected_value : 0
    };
  } catch {
    // keep defaults
  }

  // -------------------
  // Reward activity (local-only summary)
  // -------------------
  const rewardLedgerPath = path.join(ws, 'data', 'reward_ledger.jsonl');
  const rewardBalancePath = path.join(ws, 'data', 'reward_balance.json');
  let reward_credits_count = 0;
  let total_balance = 0;
  try {
    const bal = await readJsonSafe(rewardBalancePath);
    const balances = bal?.balances && typeof bal.balances === 'object' ? bal.balances : {};
    total_balance = Object.values(balances).reduce((a, b) => a + (Number(b?.balance) || 0), 0);
  } catch {}
  try {
    const raw = await fs.readFile(rewardLedgerPath, 'utf8');
    reward_credits_count = raw.split('\n').filter(Boolean).length;
  } catch {}

  const reward_activity = {
    reward_credits_count,
    total_reward_balance: total_balance,
    avg_reward_per_task: market_activity.offers_executed > 0 ? total_balance / market_activity.offers_executed : 0
  };

  // -------------------
  // Strategy
  // -------------------
  let strategy_distribution = { by_strategy_type: {} };
  try {
    const rebuilt = withSilencedConsole(() => rebuildStrategyProfiles());
    const profiles = rebuilt?.profiles?.profiles || [];
    const by = {};
    for (const p of profiles) {
      const t = safeStr(p.strategy_type) || 'unknown';
      if (!by[t]) by[t] = { count: 0, thresholds: [], avg_reward_per_task: [], avg_win_rate: [] };
      by[t].count++;
      by[t].thresholds.push(Number(p.threshold || p.accept_threshold || NaN));
      by[t].avg_reward_per_task.push(Number(p.avg_reward_per_task || NaN));
      by[t].avg_win_rate.push(Number(p.win_rate || NaN));
    }
    const out = {};
    for (const [t, v] of Object.entries(by)) {
      out[t] = {
        count: v.count,
        avg_threshold: avg(v.thresholds),
        avg_reward_per_task: avg(v.avg_reward_per_task),
        avg_win_rate: avg(v.avg_win_rate)
      };
    }
    strategy_distribution = { by_strategy_type: out };
  } catch {
    // keep defaults
  }

  // -------------------
  // Learning
  // -------------------
  let learning_activity = {
    imitation_reference_count: 0,
    imitation_evaluation_count: 0,
    improved_count: null,
    flat_count: null,
    degraded_count: null,
    most_imitated_strategy_type: null,
    imitation_success_rate: null
  };

  try {
    const insights = await withSilencedConsole(() => rebuildLearningInsights());
    const g = insights?.global || {};
    const types = Object.entries(g.strategy_type_imitated_counts || {}).sort((a, b) => b[1] - a[1]);
    learning_activity = {
      imitation_reference_count: Number(g.total_references || 0),
      imitation_evaluation_count: Number(g.total_evaluations || 0),
      improved_count: null,
      flat_count: null,
      degraded_count: null,
      most_imitated_strategy_type: types[0]?.[0] || null,
      imitation_success_rate: null
    };
  } catch {
    // keep defaults
  }

  // -------------------
  // Unified report
  // -------------------
  const report = {
    ok: true,
    generated_at: nowIso(),
    network_overview: {
      self_node_id: versionRows[versionRows.length - 1].node_id,
      current_version: selfVer.current_version,
      release_version: selfVer.release_version,
      peers_visible: peers_visible,
      peers_active: peersActive.length,
      snapshot_ok
    },
    version_distribution,
    health_distribution,
    market_activity,
    reward_activity,
    strategy_distribution,
    learning_activity,
    risks: [],
    summary: ''
  };

  report.risks = detectRisks(report);

  const riskCodes = report.risks.map((r) => r.code);
  report.summary = `versions=${Object.keys(version_distribution).length} health={healthy:${health_distribution.healthy},partial:${health_distribution.partial},degraded:${health_distribution.degraded},offline:${health_distribution.offline}} risks=${riskCodes.length ? riskCodes.join(',') : 'none'}`;

  if (args.writeCache) {
    const outPath = path.join(ws, 'data', 'network_observability.json');
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
  }

  // Inspect modes
  if (args.human) {
    humanPrint(report, { mode: args.mode });
    return;
  }

  if (args.mode === 'overview') {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }

  const pick = (k) => ({ ok: true, generated_at: report.generated_at, [k]: report[k], risks: report.risks, summary: report.summary });
  if (args.mode === 'versions') return void process.stdout.write(JSON.stringify(pick('version_distribution'), null, 2) + '\n');
  if (args.mode === 'health') return void process.stdout.write(JSON.stringify(pick('health_distribution'), null, 2) + '\n');
  if (args.mode === 'market') return void process.stdout.write(JSON.stringify(pick('market_activity'), null, 2) + '\n');
  if (args.mode === 'strategy') return void process.stdout.write(JSON.stringify(pick('strategy_distribution'), null, 2) + '\n');
  if (args.mode === 'learning') return void process.stdout.write(JSON.stringify(pick('learning_activity'), null, 2) + '\n');

  // unknown mode
  process.stdout.write(JSON.stringify({ ok: false, error: { code: 'UNKNOWN_MODE', mode: args.mode } }, null, 2) + '\n');
  process.exitCode = 2;
}

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + '\n');
  process.exit(1);
});
