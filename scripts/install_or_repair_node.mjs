#!/usr/bin/env node
/**
 * install_or_repair_node.mjs
 *
 * Goal: make node installs/upgrades idempotent and self-healing.
 * - Enforces a single canonical repo path (current working dir).
 * - Syncs OpenClaw plugin (a2a-request) into ~/.openclaw/workspace/extensions.
 * - Ensures systemd units exist + enabled + running:
 *   - a2a-http-sidecar.service (17890)
 *   - a2a-rust-uds-sidecar.service (UDS socket)
 *   - a2a-agent-daemon.service (run_agent_loop --daemon)  [CRITICAL]
 * - Runs minimal self-checks.
 *
 * NOTE: requires sudo for writing /etc/systemd/system + daemon-reload.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

function argHas(name) {
  return process.argv.includes(name);
}

function getArg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i < 0) return def;
  return process.argv[i + 1] ?? def;
}

function nowIso() {
  return new Date().toISOString();
}

async function sh(cmd, opts = {}) {
  const { stdout, stderr } = await execFileP('bash', ['-lc', cmd], { ...opts });
  return { stdout: String(stdout || ''), stderr: String(stderr || '') };
}

async function fileExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function unitHttpSidecar({ repoDir, dataDir, relayUrl }) {
  return `# /etc/systemd/system/a2a-http-sidecar.service\n[Unit]\nDescription=A2A HTTP Sidecar (Node)\nAfter=network.target\n\n[Service]\nType=simple\nUser=ubuntu\nWorkingDirectory=${repoDir}\nEnvironment=A2A_SIDECAR_PORT=17890\nEnvironment=A2A_DATA_DIR=${dataDir}\nEnvironment=A2A_ENABLE_RESPONDER_DISCOVERY=1\nEnvironment=A2A_ENABLE_AVAILABILITY_ROUTING=1\nEnvironment=A2A_ENABLE_AUTO_DOWNRANK=1\nEnvironment=RELAY_URL=${relayUrl}\nExecStart=/usr/bin/node ${repoDir}/src/sidecar/a2a_sidecar_server.mjs\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=multi-user.target\n`;
}

function unitRustUds({ repoDir }) {
  return `# /etc/systemd/system/a2a-rust-uds-sidecar.service\n[Unit]\nDescription=A2A Rust Sidecar (UDS) - upstream-first reliable local tool interface\nAfter=network.target a2a-http-sidecar.service\nRequires=a2a-http-sidecar.service\n\n[Service]\nType=simple\nUser=ubuntu\nWorkingDirectory=${repoDir}/rust/a2a-sidecar\nEnvironment=A2A_SOCK=/home/ubuntu/.openclaw/a2a/sidecar.sock\nEnvironment=A2A_HTTP_SIDECAR_URL=http://127.0.0.1:17890\nEnvironment=A2A_REQUEST_BUDGET_MS=8000\n# Default to upstream for reliability; enable libp2p only when explicitly configured\nEnvironment=A2A_LIBP2P_ENABLE=0\nExecStart=${repoDir}/rust/a2a-sidecar/target/release/a2a-sidecar\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=multi-user.target\n`;
}

function unitAgentDaemon({ repoDir, relayUrl }) {
  return `# /etc/systemd/system/a2a-agent-daemon.service\n[Unit]\nDescription=A2A Agent Runtime Daemon (run_agent_loop --daemon)\nAfter=network.target\n\n[Service]\nType=simple\nUser=ubuntu\nWorkingDirectory=${repoDir}\nEnvironment=RELAY_URL=${relayUrl}\nEnvironment=A2A_WORKSPACE_PATH=${repoDir}\nExecStart=/usr/bin/node ${repoDir}/scripts/run_agent_loop.mjs --daemon\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=multi-user.target\n`;
}

async function writeUnitIfChanged(unitPath, content) {
  const exists = await fileExists(unitPath);
  if (exists) {
    const old = await fs.readFile(unitPath, 'utf8').catch(() => '');
    if (old === content) return { changed: false };
  }
  await fs.writeFile(unitPath, content, 'utf8');
  return { changed: true };
}

async function main() {
  const repoDir = process.cwd();
  const relayUrl = String(process.env.RELAY_URL || getArg('--relay-url', 'wss://gw.bothook.me/relay')).trim();
  const dataDir = path.join(repoDir, 'data');
  const apply = argHas('--apply');

  const status = { ok: true, ts: nowIso(), repoDir, relayUrl, steps: [] };

  // Sanity: ensure expected repo structure
  if (!(await fileExists(path.join(repoDir, 'skill.md')))) {
    console.error(JSON.stringify({ ok: false, error: 'NOT_IN_REPO_ROOT', repoDir }));
    process.exit(2);
  }

  await fs.mkdir(dataDir, { recursive: true });

  // 1) Sync OpenClaw plugin
  const dst = path.join(os.homedir(), '.openclaw', 'workspace', 'extensions', 'a2a-request');
  const src = path.join(repoDir, 'extensions', 'a2a-request');
  status.steps.push({ step: 'plugin_paths', src, dst });

  if (apply) {
    await sh(`mkdir -p ${JSON.stringify(dst)}`);
    await sh(`rsync -a --delete ${JSON.stringify(src + '/')} ${JSON.stringify(dst + '/')}`);
    status.steps.push({ step: 'plugin_sync', ok: true });
  } else {
    status.steps.push({ step: 'plugin_sync', ok: false, skipped: true, reason: 'dry_run (pass --apply)' });
  }

  // 2) Ensure systemd units
  const units = [
    { name: 'a2a-http-sidecar.service', path: '/etc/systemd/system/a2a-http-sidecar.service', content: unitHttpSidecar({ repoDir, dataDir, relayUrl }) },
    { name: 'a2a-rust-uds-sidecar.service', path: '/etc/systemd/system/a2a-rust-uds-sidecar.service', content: unitRustUds({ repoDir }) },
    { name: 'a2a-agent-daemon.service', path: '/etc/systemd/system/a2a-agent-daemon.service', content: unitAgentDaemon({ repoDir, relayUrl }) },
  ];

  for (const u of units) {
    if (!apply) {
      status.steps.push({ step: 'unit_write', unit: u.name, skipped: true });
      continue;
    }
    const r = await writeUnitIfChanged(u.path, u.content);
    status.steps.push({ step: 'unit_write', unit: u.name, changed: r.changed, path: u.path });
  }

  if (apply) {
    await sh('sudo systemctl daemon-reload || systemctl daemon-reload');
    for (const u of units) {
      await sh(`sudo systemctl enable --now ${u.name} || systemctl enable --now ${u.name}`);
      await sh(`sudo systemctl restart ${u.name} || systemctl restart ${u.name}`);
    }
    status.steps.push({ step: 'systemd_enable_restart', ok: true });
  }

  // 3) Minimal self-checks
  // a) UDS sidecar echo
  try {
    const { stdout } = await sh(`curl --unix-socket "$HOME/.openclaw/a2a/sidecar.sock" -sS -H 'content-type: application/json' -d '{"task_type":"echo","payload":{"text":"hello"}}' http://localhost/a2a/request`);
    const ok = stdout.includes('"status": "success"') || stdout.includes('"ok": true');
    status.steps.push({ step: 'uds_echo', ok, preview: stdout.slice(0, 200) });
    if (!ok) status.ok = false;
  } catch (e) {
    status.steps.push({ step: 'uds_echo', ok: false, error: String(e?.message || e) });
    status.ok = false;
  }

  console.log(JSON.stringify(status, null, 2));
  if (!status.ok) process.exit(1);
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, ts: nowIso(), error: String(e?.message || e) }));
  process.exit(1);
});
