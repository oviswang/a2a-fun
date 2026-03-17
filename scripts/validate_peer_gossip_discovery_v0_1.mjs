#!/usr/bin/env node
/**
 * Validation: IMPLEMENT_PEER_GOSSIP_DISCOVERY_V0_1
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

async function readPeerCache(ws) {
  const p = path.join(ws, 'data', 'peer-cache.json');
  const s = await fs.readFile(p, 'utf-8');
  return JSON.parse(s);
}

async function main() {
  const ts = Date.now();
  const relayPort = 7502;
  const relayUrl = `ws://127.0.0.1:${relayPort}/relay`;

  const relay = spawn(process.execPath, ['src/relay/server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, RELAY_BIND: '127.0.0.1', RELAY_PORT: String(relayPort), RELAY_WS_PATH: '/relay' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const okRelay = await waitHealth(`http://127.0.0.1:${relayPort}/healthz`);
  if (!okRelay) throw new Error('relay health failed');

  const A = { id: `node_gossip_A_${ts}` };
  const B = { id: `node_gossip_B_${ts}` };
  const C = { id: `node_gossip_C_${ts}` };

  const wsA = `/tmp/a2a_gossip_A_${ts}`;
  const wsB = `/tmp/a2a_gossip_B_${ts}`;
  const wsC = `/tmp/a2a_gossip_C_${ts}`;

  for (const ws of [wsA, wsB, wsC]) {
    await fs.rm(ws, { recursive: true, force: true });
    await fs.mkdir(path.join(ws, 'data'), { recursive: true });
    await fs.writeFile(path.join(ws, 'data', 'relay-cache.json'), JSON.stringify({ ok: true, protocol: 'a2a/0.1', updated_at: new Date().toISOString(), relays: [relayUrl] }, null, 2));
  }

  // Seed peers:
  // - A knows B and C
  // - B knows A only
  // - C starts empty
  await fs.writeFile(path.join(wsA, 'data', 'peer-cache.json'), JSON.stringify({ ok: true, protocol: 'a2a/0.1', updated_at: new Date().toISOString(), peers: [
    { node_id: B.id, relay_urls: [relayUrl], capabilities: {} },
    { node_id: C.id, relay_urls: [relayUrl], capabilities: {} }
  ] }, null, 2));

  await fs.writeFile(path.join(wsB, 'data', 'peer-cache.json'), JSON.stringify({ ok: true, protocol: 'a2a/0.1', updated_at: new Date().toISOString(), peers: [
    { node_id: A.id, relay_urls: [relayUrl], capabilities: {} }
  ] }, null, 2));

  await fs.writeFile(path.join(wsC, 'data', 'peer-cache.json'), JSON.stringify({ ok: true, protocol: 'a2a/0.1', updated_at: new Date().toISOString(), peers: [] }, null, 2));

  const commonEnv = {
    ...process.env,
    BOOTSTRAP_BASE_URL: 'http://127.0.0.1:9999', // disabled
    ALLOW_LOCAL_RELAY: '1',
    RELAY_RECONNECT_ATTEMPTS: '1',
    PEER_GOSSIP_EVERY_MS: '500',
    DISABLE_SELF_MAINTENANCE: '1'
  };

  let outA = '', outB = '', outC = '';

  const pA = spawn(process.execPath, ['scripts/run_agent_loop.mjs', '--daemon', '--holder', A.id], {
    cwd: process.cwd(),
    env: { ...commonEnv, A2A_WORKSPACE_PATH: wsA, NODE_ID: A.id, A2A_AGENT_ID: A.id },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  pA.stdout.on('data', (d) => (outA += String(d)));
  pA.stderr.on('data', (d) => (outA += String(d)));

  const pB = spawn(process.execPath, ['scripts/run_agent_loop.mjs', '--daemon', '--holder', B.id], {
    cwd: process.cwd(),
    env: { ...commonEnv, A2A_WORKSPACE_PATH: wsB, NODE_ID: B.id, A2A_AGENT_ID: B.id },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  pB.stdout.on('data', (d) => (outB += String(d)));
  pB.stderr.on('data', (d) => (outB += String(d)));

  const pC = spawn(process.execPath, ['scripts/run_agent_loop.mjs', '--daemon', '--holder', C.id], {
    cwd: process.cwd(),
    env: { ...commonEnv, A2A_WORKSPACE_PATH: wsC, NODE_ID: C.id, A2A_AGENT_ID: C.id },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  pC.stdout.on('data', (d) => (outC += String(d)));
  pC.stderr.on('data', (d) => (outC += String(d)));

  // Wait for gossip to flow.
  for (let i = 0; i < 200; i++) {
    const gotB = findEvent(outB, (j) => j.event === 'PEER_GOSSIP_RECEIVED');
    const gotC = findEvent(outC, (j) => j.event === 'PEER_GOSSIP_RECEIVED');
    if (gotB && gotC) break;
    await sleep(100);
  }

  const A_sent = findEvent(outA, (j) => j.event === 'PEER_GOSSIP_SENT');
  const B_recv = findEvent(outB, (j) => j.event === 'PEER_GOSSIP_RECEIVED');
  const B_merged = findEvent(outB, (j) => j.event === 'PEER_CACHE_MERGED_FROM_GOSSIP');

  // Scenario B: B learns about C via gossip (without bootstrap)
  const cacheB = await readPeerCache(wsB);
  const bHasC = Array.isArray(cacheB?.peers) && cacheB.peers.some((p) => p?.node_id === C.id);

  // Scenario C: bootstrap disabled, C learns peers via gossip chain
  const cacheC = await readPeerCache(wsC);
  const cHasAorB = Array.isArray(cacheC?.peers) && cacheC.peers.some((p) => p?.node_id === A.id || p?.node_id === B.id);

  const okA = !!A_sent;
  const okB = !!(B_recv && B_merged && bHasC);
  const okC = !!cHasAorB;

  try { pA.kill('SIGTERM'); } catch {}
  try { pB.kill('SIGTERM'); } catch {}
  try { pC.kill('SIGTERM'); } catch {}
  try { relay.kill('SIGTERM'); } catch {}

  const ok = okA && okB && okC;

  console.log(JSON.stringify({
    ok,
    relayUrl,
    scenarioA: { ok: okA, evidence: { A_sent } },
    scenarioB: { ok: okB, evidence: { B_recv, B_merged, bHasC } },
    scenarioC: { ok: okC, evidence: { cHasAorB } }
  }, null, 2));

  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }, null, 2));
  process.exit(1);
});
