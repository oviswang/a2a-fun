import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function nowIso() {
  return new Date().toISOString();
}

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function isStableTag(v) {
  return /^v\d+\.\d+\.\d+$/.test(String(v || '').trim());
}

function parseSemver(tag) {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(String(tag || '').trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function cmp(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function sameMajorMinor(a, b) {
  return a.major === b.major && a.minor === b.minor;
}

async function fileExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readSkillRemoteVersion({ url = 'https://a2a.fun/skill.md' } = {}) {
  const r = await fetch(url, { method: 'GET' });
  if (!r.ok) return { ok: false, error: { code: 'REMOTE_HTTP', status: r.status } };
  const text = await r.text();
  const m = /\bA2A_VERSION=(v\d+\.\d+\.\d+)\b/.exec(text);
  if (!m) return { ok: false, error: { code: 'REMOTE_PARSE' } };
  return { ok: true, version: m[1] };
}

async function gitDescribe({ cwd }) {
  const { stdout } = await execFileAsync('git', ['describe', '--tags', '--always'], { cwd });
  return safeStr(stdout);
}

async function gitRevParse({ cwd, rev }) {
  const { stdout } = await execFileAsync('git', ['rev-parse', rev], { cwd });
  return safeStr(stdout);
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function copyDirRecursive(src, dst) {
  await ensureDir(dst);
  // Node 22 supports fs.cp
  await fs.cp(src, dst, { recursive: true, force: true });
}

async function writeJsonAtomic(p, obj) {
  await ensureDir(path.dirname(p));
  const tmp = p + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, p);
}

async function loadPluginsJson() {
  try {
    const { stdout } = await execFileAsync('openclaw', ['plugins', 'list', '--json']);
    return JSON.parse(String(stdout || ''));
  } catch {
    return null;
  }
}

async function healthCheck({ workspace_path } = {}) {
  const ws = workspace_path;

  // 4) runtime state exists + valid JSON (L1 only; not a hard fail for upgrade)
  const runtimeStatePath = path.join(ws, 'data', 'runtime_state.json');
  let runtimeStateExists = false;
  let runtimeStateJsonOk = false;
  try {
    runtimeStateExists = await fileExists(runtimeStatePath);
    if (runtimeStateExists) {
      const raw = await fs.readFile(runtimeStatePath, 'utf8');
      JSON.parse(String(raw || ''));
      runtimeStateJsonOk = true;
    }
  } catch {
    runtimeStateJsonOk = false;
  }

  // 2) plugin loaded
  const plugins = await loadPluginsJson();
  const a2a =
    !!plugins && Array.isArray(plugins.plugins) ? plugins.plugins.find((p) => p && p.id === 'a2a-send') : null;
  const pluginOk =
    !!a2a && a2a.enabled === true && a2a.status === 'loaded' && Number(a2a.httpRoutes || 0) >= 1;

  // 1) gateway endpoint alive (accept 200 or 401; no business payload)
  let gatewayOk = false;
  try {
    const base = safeStr(process.env.OPENCLAW_GATEWAY_URL) || 'http://127.0.0.1:18789';
    const url = base.replace(/\/$/, '') + '/__a2a__/send';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}' // minimal JSON; expected to be rejected by auth (401) or accepted (200)
    });
    gatewayOk = res && (res.status === 200 || res.status === 401);
  } catch {
    gatewayOk = false;
  }

  // 3) daemon running (system-level only; no holder dependency)
  let daemonOk = false;
  try {
    const { stdout } = await execFileAsync('bash', [
      '-lc',
      'ps aux | grep run_agent_loop | grep -v grep >/dev/null && echo yes || echo no'
    ]);
    daemonOk = safeStr(stdout) === 'yes';
  } catch {
    daemonOk = false;
  }

  // Failure policy: only fail upgrade if gateway/plugin/daemon is bad.
  const ok = gatewayOk && pluginOk && daemonOk;

  if (ok) {
    console.log(
      JSON.stringify({
        ok: true,
        event: 'AUTO_UPGRADE_HEALTHCHECK_PASS',
        checks: {
          gateway_alive: gatewayOk,
          plugin_loaded: pluginOk,
          daemon_running: daemonOk,
          runtime_state_exists: runtimeStateExists,
          runtime_state_json_ok: runtimeStateJsonOk
        }
      })
    );
  } else {
    const reasons = [];
    if (!gatewayOk) reasons.push('GATEWAY_NOT_REACHABLE');
    if (!pluginOk) reasons.push('PLUGIN_NOT_LOADED');
    if (!daemonOk) reasons.push('DAEMON_NOT_RUNNING');

    console.log(
      JSON.stringify({
        ok: false,
        event: 'AUTO_UPGRADE_HEALTHCHECK_FAIL',
        reasons,
        checks: {
          gateway_alive: gatewayOk,
          plugin_loaded: pluginOk,
          daemon_running: daemonOk,
          runtime_state_exists: runtimeStateExists,
          runtime_state_json_ok: runtimeStateJsonOk
        }
      })
    );
  }

  return {
    ok,
    checks: {
      gateway_alive: gatewayOk,
      plugin_loaded: pluginOk,
      daemon_running: daemonOk,
      runtime_state_exists: runtimeStateExists,
      runtime_state_json_ok: runtimeStateJsonOk
    }
  };
}

export async function checkAndMaybeAutoUpgrade({
  workspace_path,
  holder,
  state,
  state_path,
  checkEveryHours = 6
} = {}) {
  const ws = safeStr(workspace_path) || process.cwd();
  const h = safeStr(holder);

  if (!state || typeof state !== 'object') return { ok: true, skipped: true, reason: 'NO_STATE' };

  const lockPath = path.join(ws, 'data', 'upgrade.lock');
  const backupsDir = path.join(ws, 'backups');

  const dueMs = Math.max(1, Number(checkEveryHours) || 6) * 60 * 60 * 1000;
  const lastCheck = Date.parse(state.last_upgrade_check_at || '');
  const due = !Number.isFinite(lastCheck) || (Date.now() - lastCheck) >= dueMs;
  if (!due) {
    console.log(JSON.stringify({ ok: true, event: 'AUTO_UPGRADE_SKIPPED', reason: 'NOT_DUE' }));
    return { ok: true, skipped: true, reason: 'NOT_DUE' };
  }

  state.last_upgrade_check_at = nowIso();
  await writeJsonAtomic(state_path, state).catch(() => null);

  console.log(JSON.stringify({ ok: true, event: 'AUTO_UPGRADE_CHECK' }));

  // Rule: local repo exists
  if (!(await fileExists(path.join(ws, '.git')))) {
    console.log(JSON.stringify({ ok: true, event: 'AUTO_UPGRADE_SKIPPED', reason: 'NO_GIT_REPO' }));
    return { ok: true, skipped: true, reason: 'NO_GIT_REPO' };
  }

  // Rule: not mid-upgrade
  if (await fileExists(lockPath)) {
    console.log(JSON.stringify({ ok: true, event: 'AUTO_UPGRADE_SKIPPED', reason: 'LOCK_PRESENT' }));
    return { ok: true, skipped: true, reason: 'LOCK_PRESENT' };
  }

  // Discover versions
  let remoteTag = '';
  try {
    const remote = await readSkillRemoteVersion({});
    if (!remote.ok) throw new Error(remote?.error?.code || 'REMOTE_FAILED');
    remoteTag = remote.version;
  } catch (e) {
    state.last_upgrade_error = { at: nowIso(), code: 'REMOTE_VERSION_FAILED', message: safeStr(e?.message || e) };
    await writeJsonAtomic(state_path, state).catch(() => null);
    console.log(JSON.stringify({ ok: false, event: 'AUTO_UPGRADE_ERROR', error: state.last_upgrade_error }));
    return { ok: false, error: state.last_upgrade_error };
  }

  const localDesc = await gitDescribe({ cwd: ws }).catch(() => '');

  // Conservative: only auto-upgrade when local is a stable tag too.
  const localTag = isStableTag(localDesc) ? localDesc : '';

  // Rule: remote version is valid stable tag
  if (!isStableTag(remoteTag)) {
    console.log(JSON.stringify({ ok: true, event: 'AUTO_UPGRADE_SKIPPED', reason: 'REMOTE_NOT_STABLE_TAG', remote: remoteTag }));
    return { ok: true, skipped: true, reason: 'REMOTE_NOT_STABLE_TAG' };
  }

  // Rule: local must be a stable tag to avoid tracking main/sha
  if (!localTag) {
    console.log(JSON.stringify({ ok: true, event: 'AUTO_UPGRADE_SKIPPED', reason: 'LOCAL_NOT_TAGGED', local: localDesc }));
    return { ok: true, skipped: true, reason: 'LOCAL_NOT_TAGGED' };
  }

  const rV = parseSemver(remoteTag);
  const lV = parseSemver(localTag);
  if (!rV || !lV) {
    console.log(JSON.stringify({ ok: true, event: 'AUTO_UPGRADE_SKIPPED', reason: 'SEMVER_PARSE_FAILED', local: localTag, remote: remoteTag }));
    return { ok: true, skipped: true, reason: 'SEMVER_PARSE_FAILED' };
  }

  // Rule: remote > local
  if (cmp(rV, lV) <= 0) {
    console.log(JSON.stringify({ ok: true, event: 'AUTO_UPGRADE_SKIPPED', reason: 'NOT_NEWER', local: localTag, remote: remoteTag }));
    return { ok: true, skipped: true, reason: 'NOT_NEWER' };
  }

  // Rule: same major/minor family
  if (!sameMajorMinor(rV, lV)) {
    console.log(JSON.stringify({ ok: true, event: 'AUTO_UPGRADE_SKIPPED', reason: 'FAMILY_MISMATCH', local: localTag, remote: remoteTag }));
    return { ok: true, skipped: true, reason: 'FAMILY_MISMATCH' };
  }

  console.log(JSON.stringify({ ok: true, event: 'AUTO_UPGRADE_AVAILABLE', local: localTag, remote: remoteTag }));

  // Start upgrade
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupsDir, `data-before-auto-upgrade-${ts}.tgz`);

  const prevHead = await gitRevParse({ cwd: ws, rev: 'HEAD' }).catch(() => '');
  state.last_upgrade_attempt_at = nowIso();
  state.last_upgrade_target = remoteTag;
  await writeJsonAtomic(state_path, state).catch(() => null);

  console.log(JSON.stringify({ ok: true, event: 'AUTO_UPGRADE_STARTED', from: localTag, to: remoteTag }));

  try {
    await ensureDir(path.dirname(lockPath));
    await fs.writeFile(lockPath, JSON.stringify({ ok: true, at: nowIso(), from: localTag, to: remoteTag, prev_head: prevHead }, null, 2) + '\n', 'utf8');

    await ensureDir(backupsDir);
    // Backup data/ (do not delete)
    await execFileAsync('tar', ['-czf', backupPath, 'data'], { cwd: ws });

    await execFileAsync('git', ['fetch', '--tags', 'origin'], { cwd: ws });
    // Ensure target tag exists locally
    await execFileAsync('git', ['rev-parse', '-q', '--verify', `refs/tags/${remoteTag}`], { cwd: ws });

    await execFileAsync('git', ['checkout', '-f', remoteTag], { cwd: ws });

    // Sync plugin into ~/.openclaw/extensions/a2a-send/
    const repoPluginDir = path.join(ws, 'ops', 'openclaw', 'extensions', 'a2a-send');
    const livePluginDir = path.join(os.homedir(), '.openclaw', 'extensions', 'a2a-send');
    await copyDirRecursive(repoPluginDir, livePluginDir);

    // Restart gateway only if needed (best-effort, detached)
    // Rationale: be conservative; many nodes don't need a restart for file-sync only.
    try {
      const plugins0 = await loadPluginsJson();
      const a2aLoaded0 =
        !!plugins0 && Array.isArray(plugins0.plugins) && plugins0.plugins.some((p) => p && p.id === 'a2a-send' && p.enabled === true && p.status === 'loaded');
      if (!a2aLoaded0) {
        await execFileAsync('bash', ['-lc', 'nohup openclaw gateway restart >/dev/null 2>&1 &'], { cwd: ws }).catch(() => null);
      }
    } catch {}

    // Restart daemon (best-effort): start a fresh daemon, then exit current process.
    // We do not delete data/ and we do not stop other daemons aggressively.
    if (h) {
      await execFileAsync('bash', ['-lc', `nohup node scripts/run_agent_loop.mjs --daemon --holder ${h} >/dev/null 2>&1 &`], { cwd: ws }).catch(() => null);
    }

    const hc = await healthCheck({ workspace_path: ws });
    if (!hc.ok) {
      const err = { code: 'HEALTHCHECK_FAILED', checks: hc.checks };
      throw Object.assign(new Error('healthcheck failed'), { details: err });
    }

    state.last_upgrade_success_at = nowIso();
    state.last_upgrade_error = null;
    await writeJsonAtomic(state_path, state).catch(() => null);

    await fs.rm(lockPath).catch(() => null);

    console.log(JSON.stringify({ ok: true, event: 'AUTO_UPGRADE_SUCCESS', to: remoteTag, backup: backupPath }));

    // Exit so a supervisor (or the freshly started daemon) is the active loop.
    try {
      if (daemon && process?.exit) process.exit(0);
    } catch {}

    return { ok: true, upgraded: true, from: localTag, to: remoteTag, backup: backupPath };
  } catch (e) {
    const msg = safeStr(e?.message || e);
    const details = e?.details || null;

    // Roll back to previous head/tag (non-destructive)
    try {
      if (prevHead) await execFileAsync('git', ['checkout', '-f', prevHead], { cwd: ws });
    } catch {}

    // Remove lock
    await fs.rm(lockPath).catch(() => null);

    // Write structured error log
    const errObj = { ok: false, at: nowIso(), from: localTag, to: remoteTag, prev_head: prevHead, message: msg, details };
    try {
      await ensureDir(path.join(ws, 'data'));
      const p = path.join(ws, 'data', `auto-upgrade-error-${ts}.json`);
      await fs.writeFile(p, JSON.stringify(errObj, null, 2) + '\n', 'utf8');
    } catch {}

    state.last_upgrade_error = { at: nowIso(), code: 'UPGRADE_FAILED', message: msg, details };
    await writeJsonAtomic(state_path, state).catch(() => null);

    console.log(JSON.stringify({ ok: false, event: 'AUTO_UPGRADE_ERROR', error: state.last_upgrade_error }));
    return { ok: false, error: state.last_upgrade_error };
  }
}
