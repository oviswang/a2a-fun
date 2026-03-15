// Pre-initialize OpenClaw agent/session used by A2A live query bridge.
// Safe: sends a single read-only init message.

import { spawn } from 'node:child_process';

function run(cmd, args, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

const timeoutSeconds = process.env.OPENCLAW_LIVE_QUERY_TIMEOUT_SECONDS || '45';
const out = await run('openclaw', [
  'agent',
  '--agent',
  'a2a_bridge',
  '--json',
  '--thinking',
  'off',
  '--timeout',
  String(timeoutSeconds),
  '--message',
  'bridge init: acknowledge'
]);

let ok = out.code === 0;
let parsed = null;
try {
  parsed = JSON.parse(out.stdout);
} catch {
  // ignore
}

console.log(JSON.stringify({ ok, code: out.code, parsedOk: !!parsed, stderr: (out.stderr || '').slice(0, 800) }, null, 2));
process.exit(ok ? 0 : 1);
