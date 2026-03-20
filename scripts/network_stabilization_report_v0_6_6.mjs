#!/usr/bin/env node

// v0.6.6 stabilization-focused report (derived-only)
// Answers: are we converging? why degraded? why reward stalled? what next?

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { getNormalizedVersionInfo } from '../src/runtime/versionInfo.mjs';
import { rebuildMarketMetrics } from '../src/market/offerFeed.mjs';

const execFileAsync = promisify(execFile);

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

async function readJsonlCount(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return raw.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function systemctl(...args) {
  try {
    const { stdout } = await execFileAsync('systemctl', args);
    return safeStr(stdout);
  } catch {
    return '';
  }
}

function normalizeGitDescribeVersion(v) {
  const s = safeStr(v);
  const m = /^(v\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+)?)(?:-\d+-g[0-9a-f]+)?$/.exec(s);
  return m ? m[1] : s;
}

function semverFromTag(v) {
  const s = safeStr(v);
  const m = /^v(\d+)\.(\d+)\.(\d+)/.exec(s);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function cmp(a, b) {
  if (!a || !b) return 0;
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function classifyRewardStall({ offers_created, offers_accepted, offers_executed, value_events_count, reward_credits_count }) {
  if (offers_created <= 0) return { stalled: false, likely_breakpoint: null, likely_cause: 'no_market_activity' };
  if (reward_credits_count > 0) return { stalled: false, likely_breakpoint: null, likely_cause: null };
  if (offers_accepted <= 0) return { stalled: true, likely_breakpoint: 'accept', likely_cause: 'no_accepted_offers' };
  if (offers_executed <= 0) return { stalled: true, likely_breakpoint: 'execute', likely_cause: 'accepted_but_not_executed' };
  if (value_events_count <= 0) return { stalled: true, likely_breakpoint: 'value', likely_cause: 'executed_but_no_value_events' };
  return { stalled: true, likely_breakpoint: 'reward', likely_cause: 'value_present_but_reward_credit_missing' };
}

function parseArgs(argv) {
  const out = { human: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--human') out.human = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const ws = process.env.A2A_WORKSPACE_PATH ? String(process.env.A2A_WORKSPACE_PATH).trim() : process.cwd();

  const ver = await getNormalizedVersionInfo({ workspace_path: ws });
  const current_norm = normalizeGitDescribeVersion(ver.current_version);
  const currentSem = semverFromTag(current_norm);
  const relSem = semverFromTag(ver.release_version);

  // Best-effort min_required_version (only meaningful if manifest verified)
  let min_required_version = null;
  try {
    const url = safeStr(process.env.RELEASE_MANIFEST_URL) || 'https://a2a.fun/release.json';
    const r = await fetch(url);
    const m = await r.json().catch(() => null);
    min_required_version = ver.release_manifest_verified ? safeStr(m?.min_required_version) || null : null;
  } catch {}

  const version_stale = !!(currentSem && relSem && cmp(currentSem, relSem) < 0);

  // Degraded causes (local)
  const daemon_service = process.env.A2A_DAEMON_SERVICE || 'a2a-fun-daemon.service';
  const daemon_active = (await systemctl('is-active', daemon_service)) === 'active';
  const conflicting_enabled = (await systemctl('is-enabled', 'a2a-fun.service')) === 'enabled';
  const relay_url = safeStr(process.env.RELAY_URL);
  const expected_relay_url = 'wss://gw.bothook.me/relay';
  const relay_misconfigured = relay_url && relay_url !== expected_relay_url;

  const presence = await readJsonSafe(path.join(ws, 'data', 'presence-cache.json'));
  const peersObj = presence?.peers && typeof presence.peers === 'object' ? presence.peers : {};
  const peers_visible = Object.keys(peersObj).length;

  const latestObs = await readJsonSafe(path.join(ws, 'data', 'network_observation.latest.json'));
  const snapshot_ok = typeof latestObs?.ok === 'boolean' ? latestObs.ok : null;

  const degraded_causes = [];
  if (!daemon_active) degraded_causes.push('daemon_not_running');
  if (conflicting_enabled) degraded_causes.push('conflicting_service_enabled:a2a-fun.service');
  if (relay_misconfigured) degraded_causes.push('relay_url_mismatch');
  if (snapshot_ok === false) degraded_causes.push('snapshot_not_ok');

  const recovery_hints = [];
  if (!daemon_active) recovery_hints.push('Restart daemon: systemctl restart a2a-fun-daemon.service');
  if (conflicting_enabled) recovery_hints.push('Disable conflict: systemctl disable --now a2a-fun.service');
  if (relay_misconfigured) recovery_hints.push(`Set RELAY_URL=${expected_relay_url} and restart daemon`);
  if (snapshot_ok === false) recovery_hints.push('Run: node scripts/network_snapshot.mjs (inspect errors)');

  // Reward pipeline
  const mm = rebuildMarketMetrics();
  const m = mm.metrics || {};
  const offers_created = Number(m.total_offers || 0);
  const offers_accepted = Number(m.accepted_offers || 0);
  const offers_executed = Number(m.executed_offers || 0);

  const value_events_count = await readJsonlCount(path.join(ws, 'data', 'value_ledger.jsonl'));
  const reward_credits_count = await readJsonlCount(path.join(ws, 'data', 'reward_ledger.jsonl'));

  const reward_flow = classifyRewardStall({ offers_created, offers_accepted, offers_executed, value_events_count, reward_credits_count });

  // Recommended next actions (risk-oriented, diagnostic only)
  const recommended_next_actions = [];
  if (version_stale) recommended_next_actions.push('Check upgrade_state.json + verify release signature; eligible to retry auto-upgrade');
  if (degraded_causes.length) recommended_next_actions.push(...recovery_hints);
  if (reward_flow.stalled) recommended_next_actions.push('Run: node scripts/reward_pipeline_observability.mjs --human (identify breakpoint)');

  const report = {
    ok: true,
    generated_at: nowIso(),
    version_convergence_status: {
      current_version: current_norm,
      release_version: ver.release_version,
      min_required_version,
      signature_ok: ver.release_manifest_verified === true,
      stale: version_stale
    },
    degraded_node_causes: {
      daemon_service,
      daemon_active,
      conflicting_enabled,
      relay_url: relay_url || null,
      expected_relay_url,
      peers_visible,
      snapshot_ok,
      degraded_causes,
      recovery_hints
    },
    reward_flow_breakpoints: {
      counters: { offers_created, offers_accepted, offers_executed, value_events_count, reward_credits_count },
      trace_path: ['offer', 'accept', 'execute', 'value', 'reward'],
      stalled: reward_flow.stalled,
      likely_breakpoint: reward_flow.likely_breakpoint,
      likely_cause: reward_flow.likely_cause
    },
    recommended_next_actions
  };

  if (!args.human) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }

  const lines = [
    'A2A Network Stabilization Report (v0.6.6)',
    `- generated_at: ${report.generated_at}`,
    `- version: ${report.version_convergence_status.current_version} (release=${report.version_convergence_status.release_version || 'n/a'}) stale=${String(report.version_convergence_status.stale)}`,
    `- daemon_active: ${String(report.degraded_node_causes.daemon_active)} conflicting_enabled=${String(report.degraded_node_causes.conflicting_enabled)}`,
    `- relay_url: ${report.degraded_node_causes.relay_url || 'n/a'}`,
    `- peers_visible: ${report.degraded_node_causes.peers_visible} snapshot_ok=${String(report.degraded_node_causes.snapshot_ok)}`,
    `- reward_flow_stalled: ${String(report.reward_flow_breakpoints.stalled)} breakpoint=${report.reward_flow_breakpoints.likely_breakpoint || 'n/a'}`,
    'Next actions:',
    ...report.recommended_next_actions.map((x) => `- ${x}`)
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + '\n');
  process.exit(1);
});
