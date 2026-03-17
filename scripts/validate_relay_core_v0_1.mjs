#!/usr/bin/env node
/**
 * Validation for IMPLEMENT_RELAY_CORE_V0_1.
 * - Starts relay server.
 * - Performs raw WS upgrade and verifies HTTP 101.
 * - Opens 2 WS clients, registers node_A and node_B.
 * - Sends message A->B and verifies DELIVER payload.
 * - Confirms relay logs include RELAY_MESSAGE_FORWARD.
 */

import net from 'node:net';
import { spawn } from 'node:child_process';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function check101({ host = '127.0.0.1', port = 4011, path = '/relay' } = {}) {
  return new Promise((resolve) => {
    const key = Buffer.from(String(Date.now())).toString('base64');
    const req =
      `GET ${path} HTTP/1.1\r\n` +
      `Host: ${host}:${port}\r\n` +
      `Upgrade: websocket\r\n` +
      `Connection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${key}\r\n` +
      `Sec-WebSocket-Version: 13\r\n` +
      `\r\n`;

    const s = net.connect(port, host);
    let buf = '';
    s.on('connect', () => s.write(req));
    s.on('data', (d) => {
      buf += String(d);
      if (buf.includes('\r\n\r\n')) {
        const first = buf.split('\r\n')[0] || '';
        const ok = first.includes('101');
        try { s.end(); } catch {}
        resolve({ ok, firstLine: first });
      }
    });
    s.on('error', (e) => resolve({ ok: false, firstLine: `error:${e.message}` }));
    setTimeout(() => {
      try { s.destroy(); } catch {}
      resolve({ ok: false, firstLine: 'timeout' });
    }, 1500).unref();
  });
}

async function waitForPort({ host, port }) {
  for (let i = 0; i < 50; i++) {
    const s = net.connect(port, host);
    const ok = await new Promise((r) => {
      s.on('connect', () => r(true));
      s.on('error', () => r(false));
    });
    try { s.destroy(); } catch {}
    if (ok) return true;
    await sleep(50);
  }
  return false;
}

async function main() {
  const host = '127.0.0.1';
  const port = 4011;
  const wsUrl = `ws://${host}:${port}/relay`;

  const child = spawn(process.execPath, ['src/relay/server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, RELAY_BIND: host, RELAY_PORT: String(port), RELAY_WS_PATH: '/relay' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let logs = '';
  child.stdout.on('data', (d) => (logs += String(d)));
  child.stderr.on('data', (d) => (logs += String(d)));

  const portOk = await waitForPort({ host, port });
  if (!portOk) {
    console.log(JSON.stringify({ ok: false, step: 'listen', logs }, null, 2));
    process.exit(1);
  }

  const h = await check101({ host, port, path: '/relay' });

  const wsA = new WebSocket(wsUrl);
  const wsB = new WebSocket(wsUrl);

  const eventsB = [];

  const openA = new Promise((r) => (wsA.onopen = () => r(true)));
  const openB = new Promise((r) => (wsB.onopen = () => r(true)));

  wsB.onmessage = (ev) => {
    try {
      eventsB.push(JSON.parse(String(ev.data)));
    } catch {
      // ignore
    }
  };

  await Promise.race([Promise.all([openA, openB]), sleep(2000)]);

  wsA.send(JSON.stringify({ type: 'REGISTER', from: 'node_A' }));
  wsB.send(JSON.stringify({ type: 'REGISTER', from: 'node_B' }));

  await sleep(100);

  const payload = { x: 1, y: 'ok' };
  wsA.send(JSON.stringify({
    type: 'SEND',
    from: 'node_A',
    to: 'node_B',
    data: { topic: 'p2p.proof.v0.1', payload }
  }));

  // wait for deliver
  let deliver = null;
  for (let i = 0; i < 50; i++) {
    deliver = eventsB.find((e) => e?.type === 'DELIVER');
    if (deliver) break;
    await sleep(50);
  }

  const logForward = logs.includes('RELAY_MESSAGE_FORWARD');

  const ok =
    h.ok &&
    deliver &&
    deliver.from === 'node_A' &&
    deliver.to === 'node_B' &&
    deliver.data?.topic === 'p2p.proof.v0.1' &&
    JSON.stringify(deliver.data?.payload) === JSON.stringify(payload) &&
    logForward;

  console.log(
    JSON.stringify(
      {
        ok,
        handshake: h,
        deliver,
        relay_log_forward_seen: logForward
      },
      null,
      2
    )
  );

  try { wsA.close(); } catch {}
  try { wsB.close(); } catch {}
  try { child.kill('SIGTERM'); } catch {}

  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }, null, 2));
  process.exit(1);
});
