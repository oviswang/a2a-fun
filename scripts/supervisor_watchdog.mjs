#!/usr/bin/env node
// NODE_SUPERVISOR_LAYER_V1 (non-systemd path)
// External supervisor responsibilities:
// - detect daemon process missing
// - start daemon
// Internal auto-recovery remains in-daemon (plugin/gateway only).

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function nowIso() {
  return new Date().toISOString();
}

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

async function fileExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function readOrCreateHolder({ workspace_path } = {}) {
  const ws = safeStr(workspace_path) || process.cwd();
  const p = path.join(ws, 'data', 'node_id');
  await ensureDir(path.dirname(p));
  if (await fileExists(p)) return safeStr(await fs.readFile(p, 'utf8'));
  const h = `${os.hostname()}-${Math.random().toString(16).slice(2, 6)}`;
  await fs.writeFile(p, h + '\n', 'utf8');
  return h;
}

async function daemonCount() {
  const { stdout } = await execFileAsync('bash', [
    '-lc',
    'ps aux | grep "node scripts/run_agent_loop.mjs --daemon" | grep -v grep | wc -l'
  ]);
  const n = Number(String(stdout || '').trim());
  return Number.isFinite(n) ? n : 0;
}

async function startDaemon({ workspace_path, holder } = {}) {
  const ws = safeStr(workspace_path) || process.cwd();
  const h = safeStr(holder);
  if (!h) throw new Error('missing holder');
  await execFileAsync('bash', [
    '-lc',
    `cd ${JSON.stringify(ws)} && nohup node scripts/run_agent_loop.mjs --daemon --holder ${JSON.stringify(h)} >/dev/null 2>&1 &`
  ]);
}

function parseArgs(argv) {
  const out = {
    workspace: process.env.A2A_WORKSPACE_PATH || process.cwd(),
    holder: process.env.A2A_AGENT_ID || process.env.NODE_ID || '',
    intervalSec: 45
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--workspace') out.workspace = argv[++i] || out.workspace;
    else if (a === '--holder') out.holder = argv[++i] || out.holder;
    else if (a === '--interval-sec') out.intervalSec = Number(argv[++i] || out.intervalSec);
  }
  return out;
}

const args = parseArgs(process.argv);

const loop = async () => {
  while (true) {
    console.log(JSON.stringify({ ok: true, event: 'SUPERVISOR_CHECK', ts: nowIso() }));
    try {
      const n = await daemonCount();
      if (n >= 1) {
        console.log(JSON.stringify({ ok: true, event: 'SUPERVISOR_SKIPPED_ALREADY_RUNNING', count: n }));
      } else {
        const holder = safeStr(args.holder) || (await readOrCreateHolder({ workspace_path: args.workspace }));
        await startDaemon({ workspace_path: args.workspace, holder });
        console.log(JSON.stringify({ ok: true, event: 'SUPERVISOR_DAEMON_STARTED', holder }));
      }
    } catch (e) {
      console.log(JSON.stringify({ ok: false, event: 'SUPERVISOR_ERROR', error: { message: safeStr(e?.message || e) } }));
    }

    const ms = Math.max(30, Number(args.intervalSec) || 45) * 1000;
    await new Promise((r) => setTimeout(r, ms));
  }
};

await loop();
