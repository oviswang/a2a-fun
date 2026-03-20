#!/usr/bin/env node
/**
 * Local A2A network state view (V0.1)
 * - Human-readable
 * - Uses BOTH bootstrap directory + gossip presence cache
 * - Additive only (read-only view)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

function nowIso() {
  return new Date().toISOString();
}

async function readText(p) {
  return String(await fs.readFile(p, 'utf8'));
}

async function readJsonSafe(p) {
  try {
    const raw = await readText(p);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function uniq(xs) {
  return [...new Set(xs.filter(Boolean))];
}

function sortIds(xs) {
  return [...xs].sort((a, b) => String(a).localeCompare(String(b)));
}

function freshnessLabel(ageMs, activeWindowMs) {
  if (!Number.isFinite(ageMs)) return 'UNKNOWN';
  return ageMs <= activeWindowMs ? 'ACTIVE' : 'STALE';
}

function tryExec(cmd) {
  try {
    return String(execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] })).trim();
  } catch {
    return null;
  }
}

function parseLastEventTs(lines, eventName) {
  // lines are journalctl text lines
  let last = null;
  for (const line of lines) {
    if (!line.includes(`\"event\":\"${eventName}\"`)) continue;
    const m = line.match(/\"ts\":\"([^\"]+)\"/);
    if (m) last = m[1];
  }
  return last;
}

async function fetchBootstrapPeers(url, { timeoutMs = 2000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal });
    const j = await r.json().catch(() => null);
    const peers = Array.isArray(j?.peers) ? j.peers : [];
    return { ok: r.ok, status: r.status, peers };
  } catch (e) {
    return { ok: false, status: 0, peers: [], error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const ws = process.env.A2A_WORKSPACE_PATH ? String(process.env.A2A_WORKSPACE_PATH).trim() : process.cwd();

  const nodeIdPath = path.join(ws, 'data', 'node_id');
  const selfNodeId = (await readText(nodeIdPath).catch(() => '')).trim() || null;

  // version (normalized): prefer git tag + verified release manifest; never use package.json as primary.
  let version = (process.env.A2A_VERSION || '').trim() || null;
  if (!version) {
    try {
      const { getNormalizedVersionInfo } = await import('../src/runtime/versionInfo.mjs');
      const v = await getNormalizedVersionInfo({ workspace_path: ws });
      version = v?.current_version ? String(v.current_version) : null;
    } catch {
      version = null;
    }
  }

  // Relay status from journald for the canonical systemd unit (best-effort)
  const svc = process.env.A2A_DAEMON_SERVICE || 'a2a-fun-daemon.service';
  const pidTxt = tryExec(`systemctl show -p MainPID --value ${svc}`);
  const pid = pidTxt && /^\d+$/.test(pidTxt) ? Number(pidTxt) : null;

  let relayConnected = 'unknown';
  let keepaliveEnabled = 'unknown';
  let lastRelayConnectTs = null;
  let lastKeepaliveTs = null;

  if (pid) {
    // Targeted queries (fast): avoid scanning huge journals.
    const lineConnect = tryExec(`journalctl _PID=${pid} -g '\\"event\\":\\"RELAY_CONNECT_OK\\"' -n 1 --no-pager`);
    const lineKeepalive = tryExec(`journalctl _PID=${pid} -g '\\"event\\":\\"RELAY_KEEPALIVE_ENABLED\\"' -n 1 --no-pager`);

    lastRelayConnectTs = lineConnect ? parseLastEventTs([lineConnect], 'RELAY_CONNECT_OK') : null;
    lastKeepaliveTs = lineKeepalive ? parseLastEventTs([lineKeepalive], 'RELAY_KEEPALIVE_ENABLED') : null;

    relayConnected = lastRelayConnectTs ? 'yes' : 'unknown';
    keepaliveEnabled = lastKeepaliveTs ? 'yes' : 'unknown';
  }

  // Bootstrap view
  const bootstrapUrl = process.env.BOOTSTRAP_BASE_URL ? String(process.env.BOOTSTRAP_BASE_URL).replace(/\/$/, '') + '/peers' : 'https://bootstrap.a2a.fun/peers';
  const boot = await fetchBootstrapPeers(bootstrapUrl);
  const bootPeers = boot.peers.map((p) => ({ node_id: p?.node_id, last_seen: p?.last_seen || null }));
  const bootIds = uniq(bootPeers.map((p) => p.node_id));

  // Gossip presence view
  const presenceCachePath = path.join(ws, 'data', 'presence-cache.json');
  const presenceActiveWindowMs = Number(process.env.PRESENCE_ACTIVE_WINDOW_MS || 120_000);
  const pc = await readJsonSafe(presenceCachePath);
  const gossipPeersRaw = pc && pc.peers && typeof pc.peers === 'object' ? Object.values(pc.peers) : [];

  const gossipPeers = gossipPeersRaw
    .map((p) => {
      const peer_id = String(p?.peer_id || '').trim();
      if (!peer_id) return null;
      const ts = p?.last_presence_ts || null;
      const ageMs = ts ? Date.now() - Date.parse(ts) : NaN;
      return {
        node_id: peer_id,
        last_presence_ts: ts,
        freshness: freshnessLabel(ageMs, presenceActiveWindowMs),
        age_ms: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs)) : null,
        version: p?.version || null,
        country_code: p?.country_code || null
      };
    })
    .filter(Boolean);

  const gossipIds = uniq(gossipPeers.map((p) => p.node_id));

  // Comparison
  const bootSet = new Set(bootIds);
  const gossipSet = new Set(gossipIds);
  const both = sortIds(bootIds.filter((x) => gossipSet.has(x)));
  const bootOnly = sortIds(bootIds.filter((x) => !gossipSet.has(x)));
  const gossipOnly = sortIds(gossipIds.filter((x) => !bootSet.has(x)));

  // Print
  const lines = [];
  lines.push('A2A NETWORK STATE (V0.1)');
  lines.push(`ts: ${nowIso()}`);
  lines.push('');

  lines.push('SELF');
  lines.push(`- node_id: ${selfNodeId || 'unknown'}`);
  lines.push(`- version: ${version || 'unknown'}`);
  lines.push(`- relay_connected: ${relayConnected}${lastRelayConnectTs ? ` (last=${lastRelayConnectTs})` : ''}`);
  lines.push(`- keepalive_enabled: ${keepaliveEnabled}${lastKeepaliveTs ? ` (last=${lastKeepaliveTs})` : ''}`);
  lines.push('');

  lines.push(`BOOTSTRAP PEERS (${boot.ok ? 'ok' : 'fail'}; count=${bootIds.length})`);
  for (const p of bootPeers.sort((a, b) => String(a.node_id).localeCompare(String(b.node_id))).slice(0, 30)) {
    lines.push(`- ${p.node_id}: last_seen=${p.last_seen || 'null'}`);
  }
  if (bootPeers.length > 30) lines.push(`- ... (${bootPeers.length - 30} more)`);
  lines.push('');

  lines.push(`GOSSIP PRESENCE (${pc ? 'ok' : 'missing'}; count=${gossipIds.length})`);
  for (const p of gossipPeers.sort((a, b) => String(a.node_id).localeCompare(String(b.node_id))).slice(0, 30)) {
    const cc = p.country_code ? String(p.country_code).toUpperCase() : null;
    lines.push(`- ${p.node_id}: ${p.freshness} age_ms=${p.age_ms ?? 'null'} ts=${p.last_presence_ts || 'null'} version=${p.version || 'null'} country=${cc || 'null'}`);
  }
  if (gossipPeers.length > 30) lines.push(`- ... (${gossipPeers.length - 30} more)`);
  lines.push('');

  lines.push('COMPARISON');
  lines.push(`- both: ${both.length}`);
  lines.push(`- bootstrap_only: ${bootOnly.length}`);
  lines.push(`- gossip_only: ${gossipOnly.length}`);
  if (both.length) lines.push(`  both_ids: ${both.join(', ')}`);
  if (bootOnly.length) lines.push(`  bootstrap_only_ids: ${bootOnly.join(', ')}`);
  if (gossipOnly.length) lines.push(`  gossip_only_ids: ${gossipOnly.join(', ')}`);

  console.log(lines.join('\n'));
}

await main();
