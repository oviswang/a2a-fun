#!/usr/bin/env node
/**
 * Validation for IMPLEMENT_NODE_NETWORK_INTEGRATION_V0_1.
 * Starts local bootstrap + relay, runs agent loop (daemon+once), checks:
 * - bootstrap registry contains this node (GET /peers includes node_id)
 * - relay WS handshake is 101 (covered by relay validator; here we check REGISTER_ACK via logs)
 * - logs contain BOOTSTRAP_PUBLISH_OK and RELAY_REGISTER_OK
 */

import { spawn } from 'node:child_process';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function httpJson(url, { method = 'GET', body = null } = {}) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}
  return { status: r.status, json: j, text };
}

async function waitHealth(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const r = await httpJson(url).catch(() => null);
    if (r && r.status === 200 && r.json?.ok) return true;
    await sleep(100);
  }
  return false;
}

async function main() {
  const bootstrapPort = 4111;
  const relayPort = 4222;
  const bootstrapBase = `http://127.0.0.1:${bootstrapPort}`;
  const relayUrl = `ws://127.0.0.1:${relayPort}/relay`;

  const boot = spawn(process.execPath, ['src/bootstrap/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BOOTSTRAP_BIND: '127.0.0.1',
      BOOTSTRAP_PORT: String(bootstrapPort),
      BOOTSTRAP_REGISTRY_FILE: `.tmp/bootstrap-registry.node-net.${Date.now()}.json`,
      BOOTSTRAP_RELAYS: relayUrl
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const relay = spawn(process.execPath, ['src/relay/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RELAY_BIND: '127.0.0.1',
      RELAY_PORT: String(relayPort),
      RELAY_WS_PATH: '/relay'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const bootOk = await waitHealth(`${bootstrapBase}/healthz`);
  const relayOk = await waitHealth(`http://127.0.0.1:${relayPort}/healthz`);
  if (!bootOk || !relayOk) {
    console.log(JSON.stringify({ ok: false, step: 'health', bootOk, relayOk }, null, 2));
    process.exit(1);
  }

  const node_id = `node_integration_test_${Date.now()}`;
  const tmpWs = `/tmp/a2a_node_net_validate_${Date.now()}`;

  let out = '';
  const agent = spawn(process.execPath, ['scripts/run_agent_loop.mjs', '--once', '--daemon', '--holder', node_id], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      A2A_WORKSPACE_PATH: tmpWs,
      NODE_ID: node_id,
      A2A_AGENT_ID: node_id,
      BOOTSTRAP_BASE_URL: bootstrapBase,
      RELAY_URL: relayUrl,
      ALLOW_LOCAL_RELAY: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  agent.stdout.on('data', (d) => (out += String(d)));
  agent.stderr.on('data', (d) => (out += String(d)));

  // Let the daemon start and perform publish/connect/register.
  await sleep(6500);
  try { agent.kill('SIGTERM'); } catch {}
  // Wait briefly for exit; if it doesn't exit, force-kill.
  await Promise.race([
    new Promise((resolve) => agent.on('exit', () => resolve())),
    sleep(2000)
  ]);
  if (agent.exitCode === null) {
    try { agent.kill('SIGKILL'); } catch {}
  }

  const publishOk = out.includes('"event":"BOOTSTRAP_PUBLISH_OK"') && out.includes(node_id);
  const hbOk = out.includes('"event":"BOOTSTRAP_HEARTBEAT_OK"') && out.includes(node_id);
  const relayConnOk = out.includes('"event":"RELAY_CONNECT_OK"') && out.includes(node_id);
  const relayRegOk = out.includes('"event":"RELAY_REGISTER_OK"') && out.includes(node_id);

  const peers = await httpJson(`${bootstrapBase}/peers`);
  const inPeers = Array.isArray(peers.json?.peers) && peers.json.peers.some((p) => p?.node_id === node_id);

  const ok = publishOk && relayConnOk && relayRegOk && inPeers;

  console.log(
    JSON.stringify(
      {
        ok,
        node_id,
        logs: {
          BOOTSTRAP_PUBLISH_OK: publishOk,
          BOOTSTRAP_HEARTBEAT_OK: hbOk,
          RELAY_CONNECT_OK: relayConnOk,
          RELAY_REGISTER_OK: relayRegOk
        },
        peers_status: peers.status,
        peers_contains_node: inPeers
      },
      null,
      2
    )
  );

  try { boot.kill('SIGTERM'); } catch {}
  try { relay.kill('SIGTERM'); } catch {}

  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }, null, 2));
  process.exit(1);
});
