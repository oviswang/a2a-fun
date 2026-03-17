#!/usr/bin/env node
/**
 * Validation: IMPLEMENT_BOOTSTRAP_DEGRADED_OPERATION_V0_1
 *
 * Scenario A:
 * - bootstrap available
 * - node writes relay-cache.json + peer-cache.json
 *
 * Scenario B:
 * - bootstrap unavailable
 * - node loads relay cache
 * - node still connects/registers to relay
 *
 * Scenario C:
 * - bootstrap unavailable and cache missing
 * - node logs BOOTSTRAP_UNAVAILABLE_NO_CACHE
 * - node does not crash (continues running briefly)
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitHealth(url, tries = 80) {
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

function findEvent(buf, pred) {
  for (const ln of String(buf || '').split('\n')) {
    if (!ln.trim().startsWith('{')) continue;
    let j = null;
    try { j = JSON.parse(ln); } catch { continue; }
    if (pred(j)) return j;
  }
  return null;
}

async function fileExists(p) {
  try { await fs.stat(p); return true; } catch { return false; }
}

async function scenarioA() {
  const ts = Date.now();
  const bootPort = 7311;
  const relayPort = 7302;
  const bootBase = `http://127.0.0.1:${bootPort}`;
  const relayUrl = `ws://127.0.0.1:${relayPort}/relay`;

  const boot = spawn(process.execPath, ['src/bootstrap/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BOOTSTRAP_BIND: '127.0.0.1',
      BOOTSTRAP_PORT: String(bootPort),
      BOOTSTRAP_REGISTRY_FILE: `.tmp/bootstrap-registry.degraded.${ts}.json`,
      BOOTSTRAP_RELAYS: relayUrl
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const relay = spawn(process.execPath, ['src/relay/server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, RELAY_BIND: '127.0.0.1', RELAY_PORT: String(relayPort), RELAY_WS_PATH: '/relay' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const okBoot = await waitHealth(`${bootBase}/healthz`);
  const okRelay = await waitHealth(`http://127.0.0.1:${relayPort}/healthz`);
  if (!okBoot || !okRelay) throw new Error('scenarioA health failed');

  const node_id = `node_degraded_A_${ts}`;
  const ws = `/tmp/a2a_degraded_A_${ts}`;
  await fs.rm(ws, { recursive: true, force: true });
  await fs.mkdir(ws, { recursive: true });

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

  for (let i = 0; i < 120; i++) {
    if (findEvent(out, (j) => j.event === 'RELAY_REGISTER_OK')) break;
    await sleep(100);
  }

  const relayCache = path.join(ws, 'data', 'relay-cache.json');
  const peerCache = path.join(ws, 'data', 'peer-cache.json');

  const relayCacheOk = await fileExists(relayCache);
  const peerCacheOk = await fileExists(peerCache);

  const cacheUpdatedRelays = findEvent(out, (j) => j.event === 'BOOTSTRAP_CACHE_UPDATED' && j.kind === 'relays');
  const cacheUpdatedPeers = findEvent(out, (j) => j.event === 'BOOTSTRAP_CACHE_UPDATED' && j.kind === 'peers');

  try { agent.kill('SIGTERM'); } catch {}
  try { boot.kill('SIGTERM'); } catch {}
  try { relay.kill('SIGTERM'); } catch {}

  return {
    ok: relayCacheOk && peerCacheOk && !!cacheUpdatedRelays && !!cacheUpdatedPeers,
    evidence: { relayCacheOk, peerCacheOk, cacheUpdatedRelays, cacheUpdatedPeers },
    paths: { relayCache, peerCache }
  };
}

async function scenarioB() {
  const ts = Date.now();
  const relayPort = 7402;
  const relayUrl = `ws://127.0.0.1:${relayPort}/relay`;

  // No bootstrap server started on purpose.
  const relay = spawn(process.execPath, ['src/relay/server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, RELAY_BIND: '127.0.0.1', RELAY_PORT: String(relayPort), RELAY_WS_PATH: '/relay' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const okRelay = await waitHealth(`http://127.0.0.1:${relayPort}/healthz`);
  if (!okRelay) throw new Error('scenarioB relay health failed');

  const node_id = `node_degraded_B_${ts}`;
  const ws = `/tmp/a2a_degraded_B_${ts}`;
  await fs.rm(ws, { recursive: true, force: true });
  await fs.mkdir(path.join(ws, 'data'), { recursive: true });

  // Pre-seed cache from "previous successful bootstrap"
  await fs.writeFile(
    path.join(ws, 'data', 'relay-cache.json'),
    JSON.stringify({ ok: true, protocol: 'a2a/0.1', updated_at: new Date().toISOString(), relays: [relayUrl] }, null, 2),
    'utf-8'
  );
  await fs.writeFile(
    path.join(ws, 'data', 'peer-cache.json'),
    JSON.stringify({ ok: true, protocol: 'a2a/0.1', updated_at: new Date().toISOString(), peers: [] }, null, 2),
    'utf-8'
  );

  let out = '';
  const agent = spawn(process.execPath, ['scripts/run_agent_loop.mjs', '--daemon', '--holder', node_id], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      A2A_WORKSPACE_PATH: ws,
      NODE_ID: node_id,
      A2A_AGENT_ID: node_id,
      BOOTSTRAP_BASE_URL: 'http://127.0.0.1:9999',
      ALLOW_LOCAL_RELAY: '1',
      RELAY_RECONNECT_ATTEMPTS: '1',
      DISABLE_SELF_MAINTENANCE: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  agent.stdout.on('data', (d) => (out += String(d)));
  agent.stderr.on('data', (d) => (out += String(d)));

  for (let i = 0; i < 140; i++) {
    if (findEvent(out, (j) => j.event === 'RELAY_REGISTER_OK' && j.relay_url === relayUrl)) break;
    await sleep(100);
  }

  const usingCache = findEvent(out, (j) => j.event === 'BOOTSTRAP_UNAVAILABLE_USING_CACHE' && j.kind === 'relays');
  const cacheLoaded = findEvent(out, (j) => j.event === 'RELAY_CACHE_LOADED');
  const reg = findEvent(out, (j) => j.event === 'RELAY_REGISTER_OK' && j.relay_url === relayUrl);

  try { agent.kill('SIGTERM'); } catch {}
  try { relay.kill('SIGTERM'); } catch {}

  return { ok: !!(usingCache && cacheLoaded && reg), evidence: { usingCache, cacheLoaded, reg } };
}

async function scenarioC() {
  const ts = Date.now();
  const node_id = `node_degraded_C_${ts}`;
  const ws = `/tmp/a2a_degraded_C_${ts}`;
  await fs.rm(ws, { recursive: true, force: true });
  await fs.mkdir(ws, { recursive: true });

  let out = '';
  const agent = spawn(process.execPath, ['scripts/run_agent_loop.mjs', '--daemon', '--holder', node_id], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      A2A_WORKSPACE_PATH: ws,
      NODE_ID: node_id,
      A2A_AGENT_ID: node_id,
      BOOTSTRAP_BASE_URL: 'http://127.0.0.1:9999',
      ALLOW_LOCAL_RELAY: '1',
      RELAY_RECONNECT_ATTEMPTS: '1',
      DISABLE_SELF_MAINTENANCE: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  agent.stdout.on('data', (d) => (out += String(d)));
  agent.stderr.on('data', (d) => (out += String(d)));

  // Let it run briefly to emit degraded logs
  await sleep(1500);

  const noCache = findEvent(out, (j) => j.event === 'BOOTSTRAP_UNAVAILABLE_NO_CACHE' && j.kind === 'relays');

  // It should still be running (not crash) at this point
  const stillRunning = agent.exitCode === null;

  try { agent.kill('SIGTERM'); } catch {}

  return { ok: !!(noCache && stillRunning), evidence: { noCache, stillRunning } };
}

async function main() {
  const A = await scenarioA();
  const B = await scenarioB();
  const C = await scenarioC();
  const ok = A.ok && B.ok && C.ok;
  console.log(JSON.stringify({ ok, scenarioA: A, scenarioB: B, scenarioC: C }, null, 2));
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }, null, 2));
  process.exit(1);
});
