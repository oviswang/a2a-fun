#!/usr/bin/env node
/**
 * Validation: IMPLEMENT_BROADCAST_TASK_CLAIM_ARBITRATION_V0_1
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

function parseEvents(buf) {
  const out = [];
  for (const ln of String(buf || '').split('\n')) {
    if (!ln.trim().startsWith('{')) continue;
    try { out.push(JSON.parse(ln)); } catch {}
  }
  return out;
}

function pick(buf, pred) {
  return parseEvents(buf).filter(pred);
}

async function writeCache(ws, { relayUrl, peers }) {
  await fs.rm(ws, { recursive: true, force: true });
  await fs.mkdir(path.join(ws, 'data'), { recursive: true });
  await fs.writeFile(path.join(ws, 'data', 'relay-cache.json'), JSON.stringify({ ok: true, protocol: 'a2a/0.1', updated_at: new Date().toISOString(), relays: [relayUrl] }, null, 2));
  await fs.writeFile(path.join(ws, 'data', 'peer-cache.json'), JSON.stringify({ ok: true, protocol: 'a2a/0.1', updated_at: new Date().toISOString(), peers }, null, 2));
}

async function main() {
  const ts = Date.now();
  const relayPort = 7602;
  const relayUrl = `ws://127.0.0.1:${relayPort}/relay`;

  const relay = spawn(process.execPath, ['src/relay/server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, RELAY_BIND: '127.0.0.1', RELAY_PORT: String(relayPort), RELAY_WS_PATH: '/relay' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const okRelay = await waitHealth(`http://127.0.0.1:${relayPort}/healthz`);
  if (!okRelay) throw new Error('relay health failed');

  const A = { id: `node_arbit_A_${ts}` };
  const B = { id: `node_arbit_B_${ts}` };
  const C = { id: `node_arbit_C_${ts}` };

  const wsA = `/tmp/a2a_arbit_A_${ts}`;
  const wsB = `/tmp/a2a_arbit_B_${ts}`;
  const wsC = `/tmp/a2a_arbit_C_${ts}`;

  await writeCache(wsA, {
    relayUrl,
    peers: [
      { node_id: B.id, relay_urls: [relayUrl], capabilities: { requires: ['run_check'] } },
      { node_id: C.id, relay_urls: [relayUrl], capabilities: { requires: ['run_check'] } }
    ]
  });

  await writeCache(wsB, {
    relayUrl,
    peers: [
      { node_id: A.id, relay_urls: [relayUrl], capabilities: {} },
      { node_id: C.id, relay_urls: [relayUrl], capabilities: {} }
    ]
  });

  await writeCache(wsC, {
    relayUrl,
    peers: [
      { node_id: A.id, relay_urls: [relayUrl], capabilities: {} },
      { node_id: B.id, relay_urls: [relayUrl], capabilities: {} }
    ]
  });

  const commonEnv = {
    ...process.env,
    BOOTSTRAP_BASE_URL: 'http://127.0.0.1:9999',
    ALLOW_LOCAL_RELAY: '1',
    RELAY_RECONNECT_ATTEMPTS: '1',
    DISABLE_SELF_MAINTENANCE: '1',
    // Ensure we use broadcast path (no fixed recipient)
    TASK_PUBLISH_TO: ''
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

  // Wait for all nodes to register on relay before creating the task (deterministic)
  for (let i = 0; i < 200; i++) {
    const aReg = pick(outA, (j) => j.event === 'RELAY_REGISTER_OK').length;
    const bReg = pick(outB, (j) => j.event === 'RELAY_REGISTER_OK').length;
    const cReg = pick(outC, (j) => j.event === 'RELAY_REGISTER_OK').length;
    if (aReg && bReg && cReg) break;
    await sleep(50);
  }

  // Create one fresh task on A
  const topic = `arbit_test_${ts}`;
  const create = await new Promise((resolve) => {
    let buf = '';
    const p = spawn(process.execPath, ['scripts/tasks_demo_publish.mjs', '--type', 'run_check', '--topic', topic, '--created-by', A.id, '--check', 'relay_health'], {
      cwd: process.cwd(),
      env: { ...process.env, A2A_WORKSPACE_PATH: wsA },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    p.stdout.on('data', (d) => (buf += String(d)));
    p.stderr.on('data', (d) => (buf += String(d)));
    p.on('close', () => resolve(buf));
  });
  const created = JSON.parse(create);
  const task_id = created?.task?.task_id;
  if (!task_id) throw new Error('task_id missing');

  // wait until A gets exactly one result
  for (let i = 0; i < 250; i++) {
    const results = pick(outA, (j) => j.event === 'TASK_RESULT_RECEIVED' && j.task_id === task_id);
    const bWon = pick(outB, (j) => j.event === 'TASK_CLAIM_WON' && j.task_id === task_id);
    const cWon = pick(outC, (j) => j.event === 'TASK_CLAIM_WON' && j.task_id === task_id);
    if (results.length >= 1 && (bWon.length + cWon.length) >= 1) break;
    await sleep(100);
  }

  const A_bcast = pick(outA, (j) => j.event === 'TASK_PUBLISH_BROADCAST' && j.task_id === task_id);
  const A_results = pick(outA, (j) => j.event === 'TASK_RESULT_RECEIVED' && j.task_id === task_id);

  const B_recv = pick(outB, (j) => j.event === 'TASK_PUBLISH_RECEIVED' && j.task_id === task_id);
  const C_recv = pick(outC, (j) => j.event === 'TASK_PUBLISH_RECEIVED' && j.task_id === task_id);

  const B_attempt = pick(outB, (j) => j.event === 'TASK_CLAIM_ATTEMPT' && j.task_id === task_id);
  const C_attempt = pick(outC, (j) => j.event === 'TASK_CLAIM_ATTEMPT' && j.task_id === task_id);

  const B_won = pick(outB, (j) => j.event === 'TASK_CLAIM_WON' && j.task_id === task_id);
  const C_won = pick(outC, (j) => j.event === 'TASK_CLAIM_WON' && j.task_id === task_id);

  const B_lost = pick(outB, (j) => (j.event === 'TASK_CLAIM_LOST' || j.event === 'TASK_EXECUTION_SKIPPED_LOST_CLAIM') && j.task_id === task_id);
  const C_lost = pick(outC, (j) => (j.event === 'TASK_CLAIM_LOST' || j.event === 'TASK_EXECUTION_SKIPPED_LOST_CLAIM') && j.task_id === task_id);

  const winners = (B_won.length ? ['B'] : []).concat(C_won.length ? ['C'] : []);

  const ok =
    A_bcast.length >= 1 &&
    B_recv.length >= 1 &&
    C_recv.length >= 1 &&
    B_attempt.length >= 1 &&
    C_attempt.length >= 1 &&
    winners.length === 1 &&
    A_results.length === 1 &&
    (B_lost.length >= 1 || C_lost.length >= 1);

  try { pA.kill('SIGTERM'); } catch {}
  try { pB.kill('SIGTERM'); } catch {}
  try { pC.kill('SIGTERM'); } catch {}
  try { relay.kill('SIGTERM'); } catch {}

  console.log(JSON.stringify({
    ok,
    task_id,
    winners,
    evidence: {
      A_bcast: A_bcast.slice(0, 2),
      A_results: A_results.slice(0, 3),
      B_recv: B_recv.slice(0, 2),
      C_recv: C_recv.slice(0, 2),
      B_won: B_won.slice(0, 2),
      C_won: C_won.slice(0, 2),
      B_lost: B_lost.slice(0, 2),
      C_lost: C_lost.slice(0, 2)
    }
  }, null, 2));

  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }, null, 2));
  process.exit(1);
});
