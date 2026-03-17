#!/usr/bin/env node
/**
 * Validation for IMPLEMENT_BOOTSTRAP_CORE_V0_1.
 * - Starts bootstrap server on an ephemeral port.
 * - Simulates 2 node registrations.
 * - Verifies heartbeat updates last_seen.
 * - Verifies GET /peers non-empty.
 * - Verifies GET /network_stats returns valid JSON and never 404.
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function httpJson(url, { method = 'GET', body = null } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {
    // allow non-json only for debug
  }
  return { status: res.status, json: j, text };
}

async function main() {
  const port = 3999;
  const base = `http://127.0.0.1:${port}`;
  const registryFile = `.tmp/bootstrap-registry.validate.${Date.now()}.json`;

  await fs.rm(registryFile, { force: true }).catch(() => {});

  const child = spawn(process.execPath, ['src/bootstrap/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BOOTSTRAP_PORT: String(port),
      BOOTSTRAP_BIND: '127.0.0.1',
      BOOTSTRAP_REGISTRY_FILE: registryFile,
      BOOTSTRAP_RELAYS: 'wss://relay.example/relay'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += String(d)));
  child.stderr.on('data', (d) => (stderr += String(d)));

  // wait for server
  let ok = false;
  for (let i = 0; i < 30; i++) {
    const h = await httpJson(`${base}/healthz`).catch(() => null);
    if (h && h.status === 200 && h.json?.ok) {
      ok = true;
      break;
    }
    await sleep(100);
  }
  if (!ok) {
    console.log(JSON.stringify({ ok: false, step: 'start', stdout, stderr }, null, 2));
    process.exit(1);
  }

  const ts0 = new Date().toISOString();
  const n1 = {
    node_id: 'nodeA_test',
    version: 'v0.test',
    capabilities: { task_types: ['run_check'] },
    relay_urls: ['wss://relay.example/relay'],
    observed_addrs: [{ public_ip: '1.1.1.1', region: 'test-region-1' }],
    ts: ts0
  };
  const n2 = {
    node_id: 'nodeB_test',
    version: 'v0.test',
    capabilities: { task_types: ['run_check'] },
    relay_urls: ['wss://relay.example/relay'],
    observed_addrs: [{ public_ip: '2.2.2.2', region: 'test-region-2' }],
    ts: ts0
  };

  const r1 = await httpJson(`${base}/publish-self`, { method: 'POST', body: n1 });
  const r2 = await httpJson(`${base}/publish-self`, { method: 'POST', body: n2 });

  const peers1 = await httpJson(`${base}/peers`);
  const stats1 = await httpJson(`${base}/network_stats`);
  const relays1 = await httpJson(`${base}/relays`);

  // heartbeat updates last_seen
  const beforeSeen = peers1.json?.peers?.find((p) => p.node_id === 'nodeA_test')?.last_seen || null;
  await sleep(50);
  const hb = await httpJson(`${base}/heartbeat`, { method: 'POST', body: { node_id: 'nodeA_test', ts: nowIso() } });
  const peers2 = await httpJson(`${base}/peers`);
  const afterSeen = peers2.json?.peers?.find((p) => p.node_id === 'nodeA_test')?.last_seen || null;

  const pass =
    r1.status === 200 &&
    r2.status === 200 &&
    peers1.status === 200 &&
    Array.isArray(peers1.json?.peers) &&
    peers1.json.peers.length >= 2 &&
    stats1.status === 200 &&
    typeof stats1.json?.connected_nodes === 'number' &&
    typeof stats1.json?.active_agents_last_24h === 'number' &&
    stats1.json?.regions &&
    relays1.status === 200 &&
    Array.isArray(relays1.json?.relays) &&
    hb.status === 200 &&
    beforeSeen &&
    afterSeen &&
    beforeSeen !== afterSeen;

  console.log(
    JSON.stringify(
      {
        ok: pass,
        publish_self: { r1_status: r1.status, r2_status: r2.status },
        peers_before_count: peers1.json?.peers?.length ?? null,
        peers_after_count: peers2.json?.peers?.length ?? null,
        heartbeat_status: hb.status,
        last_seen_before: beforeSeen,
        last_seen_after: afterSeen,
        network_stats: stats1.json,
        relays: relays1.json
      },
      null,
      2
    )
  );

  child.kill('SIGTERM');
  await sleep(50);
  await fs.rm(registryFile, { force: true }).catch(() => {});

  process.exit(pass ? 0 : 2);
}

function nowIso() {
  return new Date().toISOString();
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }, null, 2));
  process.exit(1);
});
