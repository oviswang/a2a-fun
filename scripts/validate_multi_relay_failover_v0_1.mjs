#!/usr/bin/env node
/**
 * Validation for IMPLEMENT_MULTI_RELAY_FAILOVER_V0_1.
 *
 * Scenario A:
 * - relay[0] unavailable
 * - node falls back to relay[1]
 *
 * Scenario B:
 * - node registers on relay[0]
 * - relay[0] is killed
 * - node logs disconnect and fails over to relay[1]
 */

import { spawn } from 'node:child_process';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      const j = await r.json().catch(() => null);
      if (r.status === 200 && j?.ok) return true;
    } catch {}
    await sleep(100);
  }
  return false;
}

function hasEvent(buf, pred) {
  for (const ln of String(buf || '').split('\n')) {
    if (!ln.trim().startsWith('{')) continue;
    let j = null;
    try {
      j = JSON.parse(ln);
    } catch {
      continue;
    }
    if (pred(j)) return j;
  }
  return null;
}

async function runScenarioA() {
  const ts = Date.now();
  const bootPort = 7111;
  const relay2Port = 7002;
  const bootBase = `http://127.0.0.1:${bootPort}`;
  const relay1 = `ws://127.0.0.1:7001/relay`; // intentionally down
  const relay2 = `ws://127.0.0.1:${relay2Port}/relay`;

  const boot = spawn(process.execPath, ['src/bootstrap/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BOOTSTRAP_BIND: '127.0.0.1',
      BOOTSTRAP_PORT: String(bootPort),
      BOOTSTRAP_REGISTRY_FILE: `.tmp/bootstrap-registry.failoverA.${ts}.json`,
      BOOTSTRAP_RELAYS: `${relay1},${relay2}`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const r2 = spawn(process.execPath, ['src/relay/server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, RELAY_BIND: '127.0.0.1', RELAY_PORT: String(relay2Port), RELAY_WS_PATH: '/relay' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const okBoot = await waitHealth(`${bootBase}/healthz`);
  const okRelay = await waitHealth(`http://127.0.0.1:${relay2Port}/healthz`);
  if (!okBoot || !okRelay) throw new Error('scenarioA health failed');

  const node_id = `node_failoverA_${ts}`;
  const ws = `/tmp/a2a_failoverA_${ts}`;
  let out = '';

  const agent = spawn(process.execPath, ['scripts/run_agent_loop.mjs', '--daemon', '--holder', node_id], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      A2A_WORKSPACE_PATH: ws,
      NODE_ID: node_id,
      A2A_AGENT_ID: node_id,
      BOOTSTRAP_BASE_URL: bootBase,
      ALLOW_LOCAL_RELAY: '1',
      RELAY_RECONNECT_ATTEMPTS: '1',
      DISABLE_SELF_MAINTENANCE: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  agent.stdout.on('data', (d) => (out += String(d)));
  agent.stderr.on('data', (d) => (out += String(d)));

  // wait for register ok on relay2
  for (let i = 0; i < 100; i++) {
    if (hasEvent(out, (j) => j.event === 'RELAY_REGISTER_OK' && j.relay_url === relay2)) break;
    await sleep(100);
  }

  const attempt0 = hasEvent(out, (j) => j.event === 'RELAY_CONNECT_ATTEMPT' && j.relay_url === relay1);
  const failover = hasEvent(out, (j) => j.event === 'RELAY_FAILOVER_NEXT' && j.relay_url === relay2);
  const reg2 = hasEvent(out, (j) => j.event === 'RELAY_REGISTER_OK' && j.relay_url === relay2);

  try {
    agent.kill('SIGTERM');
  } catch {}
  try {
    boot.kill('SIGTERM');
  } catch {}
  try {
    r2.kill('SIGTERM');
  } catch {}

  return { ok: !!(attempt0 && failover && reg2), evidence: { attempt0, failover, reg2 }, relay1, relay2 };
}

async function runScenarioB() {
  const ts = Date.now();
  const bootPort = 7211;
  const relay1Port = 7101;
  const relay2Port = 7102;

  const bootBase = `http://127.0.0.1:${bootPort}`;
  const relay1 = `ws://127.0.0.1:${relay1Port}/relay`;
  const relay2 = `ws://127.0.0.1:${relay2Port}/relay`;

  const boot = spawn(process.execPath, ['src/bootstrap/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BOOTSTRAP_BIND: '127.0.0.1',
      BOOTSTRAP_PORT: String(bootPort),
      BOOTSTRAP_REGISTRY_FILE: `.tmp/bootstrap-registry.failoverB.${ts}.json`,
      BOOTSTRAP_RELAYS: `${relay1},${relay2}`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const r1 = spawn(process.execPath, ['src/relay/server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, RELAY_BIND: '127.0.0.1', RELAY_PORT: String(relay1Port), RELAY_WS_PATH: '/relay' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const r2 = spawn(process.execPath, ['src/relay/server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, RELAY_BIND: '127.0.0.1', RELAY_PORT: String(relay2Port), RELAY_WS_PATH: '/relay' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const okBoot = await waitHealth(`${bootBase}/healthz`);
  const okR1 = await waitHealth(`http://127.0.0.1:${relay1Port}/healthz`);
  const okR2 = await waitHealth(`http://127.0.0.1:${relay2Port}/healthz`);
  if (!okBoot || !okR1 || !okR2) throw new Error('scenarioB health failed');

  const node_id = `node_failoverB_${ts}`;
  const ws = `/tmp/a2a_failoverB_${ts}`;
  let out = '';

  const agent = spawn(process.execPath, ['scripts/run_agent_loop.mjs', '--daemon', '--holder', node_id], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      A2A_WORKSPACE_PATH: ws,
      NODE_ID: node_id,
      A2A_AGENT_ID: node_id,
      BOOTSTRAP_BASE_URL: bootBase,
      ALLOW_LOCAL_RELAY: '1',
      RELAY_RECONNECT_ATTEMPTS: '1',
      DISABLE_SELF_MAINTENANCE: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  agent.stdout.on('data', (d) => (out += String(d)));
  agent.stderr.on('data', (d) => (out += String(d)));

  // wait initial register on relay1
  for (let i = 0; i < 100; i++) {
    if (hasEvent(out, (j) => j.event === 'RELAY_REGISTER_OK' && j.relay_url === relay1)) break;
    await sleep(100);
  }

  // kill relay1 to force disconnect
  try {
    r1.kill('SIGTERM');
  } catch {}

  // wait failover register on relay2
  for (let i = 0; i < 140; i++) {
    if (hasEvent(out, (j) => j.event === 'RELAY_REGISTER_OK' && j.relay_url === relay2)) break;
    await sleep(100);
  }

  const disconnected = hasEvent(out, (j) => j.event === 'RELAY_DISCONNECTED' && j.relay_url === relay1);
  const failoverNext = hasEvent(out, (j) => j.event === 'RELAY_FAILOVER_NEXT' && j.relay_url === relay2);
  const reg2 = hasEvent(out, (j) => j.event === 'RELAY_REGISTER_OK' && j.relay_url === relay2);

  try {
    agent.kill('SIGTERM');
  } catch {}
  try {
    boot.kill('SIGTERM');
  } catch {}
  try {
    r2.kill('SIGTERM');
  } catch {}

  return { ok: !!(disconnected && failoverNext && reg2), evidence: { disconnected, failoverNext, reg2 }, relay1, relay2 };
}

async function main() {
  const a = await runScenarioA();
  const b = await runScenarioB();
  const ok = a.ok && b.ok;
  console.log(JSON.stringify({ ok, scenarioA: a, scenarioB: b }, null, 2));
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }, null, 2));
  process.exit(1);
});
