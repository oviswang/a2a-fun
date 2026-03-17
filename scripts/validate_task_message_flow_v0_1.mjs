#!/usr/bin/env node
/**
 * Validation for IMPLEMENT_TASK_MESSAGE_FLOW_V0_1.
 * Controlled proof (single machine, two isolated workspaces) through relay path:
 * 1) Node A publishes a fresh task
 * 2) A sends task.publish to B over relay
 * 3) B receives task.publish
 * 4) B accepts task (agent loop) and sends task.claim to A
 * 5) A receives task.claim
 * 6) B executes task and sends task.result to A
 * 7) A receives task.result
 */

import { spawn } from 'node:child_process';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(url, tries = 50) {
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

function hasLine(buf, pred) {
  const lines = buf.split('\n');
  for (const ln of lines) {
    if (!ln.trim().startsWith('{')) continue;
    let j;
    try { j = JSON.parse(ln); } catch { continue; }
    if (pred(j)) return j;
  }
  return null;
}

async function main() {
  const ts = Date.now();
  const bootstrapPort = 6111;
  const relayPort = 6222;
  const bootstrapBase = `http://127.0.0.1:${bootstrapPort}`;
  const relayUrl = `ws://127.0.0.1:${relayPort}/relay`;

  const boot = spawn(process.execPath, ['src/bootstrap/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BOOTSTRAP_BIND: '127.0.0.1',
      BOOTSTRAP_PORT: String(bootstrapPort),
      BOOTSTRAP_REGISTRY_FILE: `.tmp/bootstrap-registry.task-flow.${ts}.json`,
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
    console.log(JSON.stringify({ ok: false, step: 'health', bootOk, relayOk }));
    process.exit(1);
  }

  const nodeA = `nodeA_taskflow_${ts}`;
  const nodeB = `nodeB_taskflow_${ts}`;
  const wsA = `/tmp/a2a_taskflow_ws_A_${ts}`;
  const wsB = `/tmp/a2a_taskflow_ws_B_${ts}`;

  let outA = '';
  let outB = '';

  const procB = spawn(process.execPath, ['scripts/run_agent_loop.mjs', '--daemon', '--holder', nodeB], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      A2A_WORKSPACE_PATH: wsB,
      NODE_ID: nodeB,
      A2A_AGENT_ID: nodeB,
      BOOTSTRAP_BASE_URL: bootstrapBase,
      RELAY_URL: relayUrl,
      ALLOW_LOCAL_RELAY: '1',
      DISABLE_SELF_MAINTENANCE: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  procB.stdout.on('data', (d) => (outB += String(d)));
  procB.stderr.on('data', (d) => (outB += String(d)));

  // start A
  const procA = spawn(process.execPath, ['scripts/run_agent_loop.mjs', '--daemon', '--holder', nodeA], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      A2A_WORKSPACE_PATH: wsA,
      NODE_ID: nodeA,
      A2A_AGENT_ID: nodeA,
      BOOTSTRAP_BASE_URL: bootstrapBase,
      RELAY_URL: relayUrl,
      ALLOW_LOCAL_RELAY: '1',
      TASK_PUBLISH_TO: nodeB,
      DISABLE_SELF_MAINTENANCE: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  procA.stdout.on('data', (d) => (outA += String(d)));
  procA.stderr.on('data', (d) => (outA += String(d)));

  // wait for both to register
  for (let i = 0; i < 80; i++) {
    const aReg = outA.includes('"event":"RELAY_REGISTER_OK"');
    const bReg = outB.includes('"event":"RELAY_REGISTER_OK"');
    if (aReg && bReg) break;
    await sleep(100);
  }

  // create fresh task in A workspace
  const topic = `p2p_proof_${ts}`;
  let publishOut = '';
  const pub = spawn(process.execPath, ['scripts/tasks_demo_publish.mjs', '--type', 'run_check', '--topic', topic, '--created-by', nodeA, '--check', 'relay_health'], {
    cwd: process.cwd(),
    env: { ...process.env, A2A_WORKSPACE_PATH: wsA }
  });
  pub.stdout.on('data', (d) => (publishOut += String(d)));
  pub.stderr.on('data', (d) => (publishOut += String(d)));
  await new Promise((r) => pub.on('exit', () => r()));

  let task_id = null;
  try {
    const j = JSON.parse(publishOut);
    task_id = j?.task?.task_id || null;
  } catch {}

  if (!task_id) {
    console.log(JSON.stringify({ ok: false, step: 'task_create', publishOut }));
    process.exit(1);
  }

  // wait for flow evidence
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const aPublishSent = hasLine(outA, (j) => j.event === 'TASK_PUBLISH_SENT' && j.task_id === task_id && j.to === nodeB);
    const bPublishRecv = hasLine(outB, (j) => j.event === 'TASK_PUBLISH_RECEIVED' && j.task_id === task_id);
    const bClaimSent = hasLine(outB, (j) => j.event === 'TASK_CLAIM_SENT' && j.task_id === task_id && j.to === nodeA);
    const aClaimRecv = hasLine(outA, (j) => j.event === 'TASK_CLAIM_RECEIVED' && j.task_id === task_id);
    const bResultSent = hasLine(outB, (j) => j.event === 'TASK_RESULT_SENT' && j.task_id === task_id && j.to === nodeA);
    const aResultRecv = hasLine(outA, (j) => j.event === 'TASK_RESULT_RECEIVED' && j.task_id === task_id);

    if (aPublishSent && bPublishRecv && bClaimSent && aClaimRecv && bResultSent && aResultRecv) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            nodeA,
            nodeB,
            task_id,
            evidence: {
              TASK_PUBLISH_SENT: aPublishSent,
              TASK_PUBLISH_RECEIVED: bPublishRecv,
              TASK_CLAIM_SENT: bClaimSent,
              TASK_CLAIM_RECEIVED: aClaimRecv,
              TASK_RESULT_SENT: bResultSent,
              TASK_RESULT_RECEIVED: aResultRecv
            }
          },
          null,
          2
        )
      );

      try { procA.kill('SIGTERM'); } catch {}
      try { procB.kill('SIGTERM'); } catch {}
      try { boot.kill('SIGTERM'); } catch {}
      try { relay.kill('SIGTERM'); } catch {}

      process.exit(0);
    }

    await sleep(150);
  }

  const tail = (s) => String(s || '').split('\n').slice(-80).join('\n');
  console.log(
    JSON.stringify(
      {
        ok: false,
        nodeA,
        nodeB,
        task_id,
        missing: {
          A_TASK_PUBLISH_SENT: !hasLine(outA, (j) => j.event === 'TASK_PUBLISH_SENT' && j.task_id === task_id),
          B_TASK_PUBLISH_RECEIVED: !hasLine(outB, (j) => j.event === 'TASK_PUBLISH_RECEIVED' && j.task_id === task_id),
          B_TASK_CLAIM_SENT: !hasLine(outB, (j) => j.event === 'TASK_CLAIM_SENT' && j.task_id === task_id),
          A_TASK_CLAIM_RECEIVED: !hasLine(outA, (j) => j.event === 'TASK_CLAIM_RECEIVED' && j.task_id === task_id),
          B_TASK_RESULT_SENT: !hasLine(outB, (j) => j.event === 'TASK_RESULT_SENT' && j.task_id === task_id),
          A_TASK_RESULT_RECEIVED: !hasLine(outA, (j) => j.event === 'TASK_RESULT_RECEIVED' && j.task_id === task_id)
        },
        outA_tail: tail(outA),
        outB_tail: tail(outB)
      },
      null,
      2
    )
  );

  try { procA.kill('SIGKILL'); } catch {}
  try { procB.kill('SIGKILL'); } catch {}
  try { boot.kill('SIGKILL'); } catch {}
  try { relay.kill('SIGKILL'); } catch {}

  process.exit(2);
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }, null, 2));
  process.exit(1);
});
