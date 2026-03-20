import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { getNormalizedVersionInfo } from './versionInfo.mjs';

const execFileAsync = promisify(execFile);

function nowIso() {
  return new Date().toISOString();
}

function safeStr(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

async function readJsonSafe(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(String(raw || ''));
  } catch {
    return null;
  }
}

function normalizeGitDescribeVersion(v) {
  const s = safeStr(v);
  const m = /^(v\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+)?)(?:-\d+-g[0-9a-f]+)?$/.exec(s);
  return m ? m[1] : s;
}

function semverFromTag(v) {
  // Accept v0.6.4, v0.6.4-stable
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

function isActiveTs(tsIso, windowMs) {
  try {
    const t = Date.parse(String(tsIso));
    if (!Number.isFinite(t)) return false;
    return Date.now() - t <= windowMs;
  } catch {
    return false;
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

function emit(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + '\n');
  } catch {}
}

function classifyRewardStall({ offers_created, offers_accepted, offers_executed, value_events_count, reward_credits_count }) {
  if (offers_created <= 0) return { stalled: false, likely_cause: null };
  if (reward_credits_count > 0) return { stalled: false, likely_cause: null };

  // Stalled
  if (offers_accepted <= 0) return { stalled: true, likely_cause: 'no_accepted_offers' };
  if (offers_executed <= 0) return { stalled: true, likely_cause: 'accepted_but_not_executed' };
  if (value_events_count <= 0) return { stalled: true, likely_cause: 'executed_but_no_value_events' };
  // value_events exist but reward credits missing
  return { stalled: true, likely_cause: 'value_present_but_reward_credit_missing' };
}

export async function emitStabilizationSignalsV0_6_6({
  workspace_path,
  node_id,
  daemon_service = 'a2a-fun-daemon.service'
} = {}) {
  const ws = workspace_path || process.env.A2A_WORKSPACE_PATH || process.cwd();
  const nid = safeStr(node_id) || safeStr(process.env.NODE_ID) || safeStr(process.env.A2A_AGENT_ID) || 'unknown';

  // -----------------
  // Version stale detection
  // -----------------
  const ver = await getNormalizedVersionInfo({ workspace_path: ws });
  const current_norm = normalizeGitDescribeVersion(ver.current_version);
  const currentSem = semverFromTag(current_norm);
  const relSem = semverFromTag(ver.release_version);

  // Pull min_required_version from manifest (best-effort, derived; do not trust if signature not ok)
  let min_required_version = null;
  try {
    const url = safeStr(process.env.RELEASE_MANIFEST_URL) || 'https://a2a.fun/release.json';
    const r = await fetch(url);
    const m = await r.json().catch(() => null);
    min_required_version = ver.release_manifest_verified ? safeStr(m?.min_required_version) || null : null;
  } catch {}

  const isStale = !!(currentSem && relSem && cmp(currentSem, relSem) < 0);
  if (isStale) {
    emit({
      ok: true,
      event: 'NODE_VERSION_STALE',
      ts: nowIso(),
      node_id: nid,
      current_version: current_norm,
      release_version: ver.release_version,
      min_required_version,
      version_source: ver.version_source,
      signature_ok: ver.release_manifest_verified === true
    });

    if (ver.release_manifest_verified === true) {
      emit({
        ok: true,
        event: 'NODE_UPGRADE_RETRY_ELIGIBLE',
        ts: nowIso(),
        node_id: nid,
        current_version: current_norm,
        target_version: ver.release_version,
        reason_blocked: null
      });
    }
  }

  // -----------------
  // Degraded node classification + hints (local)
  // -----------------
  const daemon_active = (await systemctl('is-active', daemon_service)) === 'active';
  const conflicting_enabled = (await systemctl('is-enabled', 'a2a-fun.service')) === 'enabled';
  const relay_url = safeStr(process.env.RELAY_URL);
  const expected_relay_url = 'wss://gw.bothook.me/relay';
  const relay_misconfigured = relay_url && relay_url !== expected_relay_url;

  // Presence freshness
  const presence = await readJsonSafe(path.join(ws, 'data', 'presence-cache.json'));
  const peersObj = isPlainObject(presence?.peers) ? presence.peers : {};
  const peers = Object.values(peersObj).filter((p) => isPlainObject(p));
  const activeWindowMs = Number(process.env.PRESENCE_ACTIVE_WINDOW_MS || 120_000);
  const peers_active = peers.filter((p) => isActiveTs(p.last_presence_ts, activeWindowMs)).length;

  // Snapshot success (best-effort): use latest derived observation
  let snapshot_ok = null;
  try {
    const latest = await readJsonSafe(path.join(ws, 'data', 'network_observation.latest.json'));
    snapshot_ok = typeof latest?.ok === 'boolean' ? latest.ok : null;
  } catch {
    snapshot_ok = null;
  }

  const degraded_causes = [];
  if (!daemon_active) degraded_causes.push('daemon_not_running');
  if (conflicting_enabled) degraded_causes.push('conflicting_service_enabled:a2a-fun.service');
  if (relay_misconfigured) degraded_causes.push('relay_url_mismatch');
  if (peers_active === 0) degraded_causes.push('no_active_peers_seen');
  if (snapshot_ok === false) degraded_causes.push('snapshot_not_ok');

  const isDegraded = degraded_causes.length > 0;
  if (isDegraded) {
    emit({
      ok: true,
      event: 'NODE_HEALTH_DEGRADED',
      ts: nowIso(),
      node_id: nid,
      degraded_causes,
      metrics: {
        daemon_active,
        conflicting_enabled,
        relay_url: relay_url || null,
        expected_relay_url,
        peers_visible: peers.length,
        peers_active,
        snapshot_ok
      }
    });

    const hints = [];
    if (!daemon_active) hints.push('Restart daemon service: systemctl restart a2a-fun-daemon.service');
    if (conflicting_enabled) hints.push('Disable conflicting service: systemctl disable --now a2a-fun.service');
    if (relay_misconfigured) hints.push(`Set RELAY_URL=${expected_relay_url} and restart daemon`);
    if (peers_active === 0) hints.push('Check relay connectivity + firewall + DNS; verify RELAY_SEND_ATTEMPT ws_ready_state=1 in journal');
    if (snapshot_ok === false) hints.push('Run: node scripts/network_snapshot.mjs and inspect errors; verify bootstrap /peers reachable');

    emit({
      ok: true,
      event: 'NODE_HEALTH_RECOVERY_HINT',
      ts: nowIso(),
      node_id: nid,
      hints
    });
  }

  // -----------------
  // Reward flow stall diagnostics (local)
  // -----------------
  let offers_created = 0;
  let offers_accepted = 0;
  let offers_executed = 0;
  try {
    const { rebuildMarketMetrics } = await import('../market/offerFeed.mjs');
    const mm = rebuildMarketMetrics();
    offers_created = Number(mm?.metrics?.total_offers || 0);
    offers_accepted = Number(mm?.metrics?.accepted_offers || 0);
    offers_executed = Number(mm?.metrics?.executed_offers || 0);
  } catch {}

  // value events
  let value_events_count = 0;
  try {
    const raw = await fs.readFile(path.join(ws, 'data', 'value_ledger.jsonl'), 'utf8');
    value_events_count = raw.split('\n').filter(Boolean).length;
  } catch {}

  // reward credits
  let reward_credits_count = 0;
  try {
    const raw = await fs.readFile(path.join(ws, 'data', 'reward_ledger.jsonl'), 'utf8');
    reward_credits_count = raw.split('\n').filter(Boolean).length;
  } catch {}

  const stall = classifyRewardStall({ offers_created, offers_accepted, offers_executed, value_events_count, reward_credits_count });
  if (stall.stalled) {
    emit({
      ok: true,
      event: 'REWARD_FLOW_STALLED',
      ts: nowIso(),
      node_id: nid,
      likely_cause: stall.likely_cause,
      counters: {
        offers_created,
        offers_accepted,
        offers_executed,
        value_events_count,
        reward_credits_count
      },
      trace_path: ['offer', 'accept', 'execute', 'value', 'reward']
    });
  }

  return { ok: true };
}
