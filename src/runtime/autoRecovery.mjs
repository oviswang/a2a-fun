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

async function copyDirRecursive(src, dst) {
  await ensureDir(dst);
  await fs.cp(src, dst, { recursive: true, force: true });
}

async function loadPluginsJson({ execImpl = execFileAsync } = {}) {
  try {
    const { stdout } = await execImpl('openclaw', ['plugins', 'list', '--json']);
    return { ok: true, json: JSON.parse(String(stdout || '')) };
  } catch {
    return { ok: false, error: { code: 'OPENCLAW_CLI_UNAVAILABLE' } };
  }
}

async function gatewayRouteAlive({ fetchImpl = globalThis.fetch } = {}) {
  try {
    const base = safeStr(process.env.OPENCLAW_GATEWAY_URL) || 'http://127.0.0.1:18789';
    const url = base.replace(/\/$/, '') + '/__a2a__/send';
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}' // minimal JSON
    });
    return !!res && (res.status === 200 || res.status === 401);
  } catch {
    return false;
  }
}

async function daemonCount({ execImpl = execFileAsync } = {}) {
  try {
    const { stdout } = await execImpl('bash', [
      '-lc',
      'ps aux | grep "node scripts/run_agent_loop.mjs --daemon" | grep -v grep | wc -l'
    ]);
    const n = Number(String(stdout || '').trim());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

async function restartGatewayDetached({ execImpl = execFileAsync } = {}) {
  await execImpl('bash', ['-lc', 'nohup openclaw gateway restart >/dev/null 2>&1 &']).catch(() => null);
}

async function restartDaemonDetached({ workspace_path, holder, execImpl = execFileAsync } = {}) {
  const ws = safeStr(workspace_path) || process.cwd();
  const h = safeStr(holder);
  if (!h) return;
  await execImpl('bash', ['-lc', `nohup node scripts/run_agent_loop.mjs --daemon --holder ${h} >/dev/null 2>&1 &`], { cwd: ws }).catch(() => null);
}

export async function runAutoRecoveryCheck({
  workspace_path,
  holder,
  state,
  state_path,
  checkEveryMinutes = 10,
  // injections for controlled validation
  fetchImpl,
  execImpl
} = {}) {
  const ws = safeStr(workspace_path) || process.cwd();
  const h = safeStr(holder);
  const exec0 = execImpl || execFileAsync;
  const fetch0 = fetchImpl || globalThis.fetch;

  if (!state || typeof state !== 'object') {
    console.log(JSON.stringify({ ok: true, event: 'AUTO_RECOVERY_SKIPPED', reason: 'NO_STATE' }));
    return { ok: true, skipped: true, reason: 'NO_STATE' };
  }

  const dueMs = Math.max(1, Number(checkEveryMinutes) || 10) * 60 * 1000;
  const lastCheck = Date.parse(state.last_recovery_check_at || '');
  const due = !Number.isFinite(lastCheck) || (Date.now() - lastCheck) >= dueMs;
  if (!due) {
    console.log(JSON.stringify({ ok: true, event: 'AUTO_RECOVERY_SKIPPED', reason: 'NOT_DUE' }));
    return { ok: true, skipped: true, reason: 'NOT_DUE' };
  }

  state.last_recovery_check_at = nowIso();
  console.log(JSON.stringify({ ok: true, event: 'AUTO_RECOVERY_CHECK' }));

  const recordAction = (action, extra = null) => {
    state.last_recovery_action_at = nowIso();
    state.last_recovery_action = action;
    state.last_recovery_error = null;
    if (extra && typeof extra === 'object') state.last_recovery_action_meta = extra;
  };

  const within30mSameAction = (action) => {
    const lastAt = Date.parse(state.last_recovery_action_at || '');
    const lastAction = safeStr(state.last_recovery_action || '');
    if (!lastAction || !Number.isFinite(lastAt)) return false;
    if (lastAction !== action) return false;
    return (Date.now() - lastAt) < 30 * 60 * 1000;
  };

  const recordError = (code, message, details = null) => {
    state.last_recovery_action_at = nowIso();
    state.last_recovery_error = { at: nowIso(), code, message: safeStr(message), details };
  };

  let gatewayRestartedThisCycle = false;
  let gatewayOk = await gatewayRouteAlive({ fetchImpl: fetch0 });

  // C) gateway route unavailable
  if (!gatewayOk) {
    if (within30mSameAction('GATEWAY_RESTARTED')) {
      console.log(JSON.stringify({ ok: true, event: 'AUTO_RECOVERY_SKIPPED', reason: 'RATE_LIMIT', category: 'gateway' }));
    } else {
      try {
        // Verify plugin presence; restart gateway; retest.
        const repoPluginDir = path.join(ws, 'ops', 'openclaw', 'extensions', 'a2a-send');
        const livePluginDir = path.join(os.homedir(), '.openclaw', 'extensions', 'a2a-send');
        if (await fileExists(repoPluginDir)) {
          if (!(await fileExists(livePluginDir))) await copyDirRecursive(repoPluginDir, livePluginDir);
        }

        await restartGatewayDetached({ execImpl: exec0 });
        gatewayRestartedThisCycle = true;
        console.log(JSON.stringify({ ok: true, event: 'AUTO_RECOVERY_GATEWAY_RESTARTED' }));
        recordAction('GATEWAY_RESTARTED');

        gatewayOk = await gatewayRouteAlive({ fetchImpl: fetch0 });
        if (!gatewayOk) {
          recordError('GATEWAY_ROUTE_STILL_DOWN', 'gateway route still unavailable after restart');
          console.log(JSON.stringify({ ok: false, event: 'AUTO_RECOVERY_ERROR', error: state.last_recovery_error }));
        }
      } catch (e) {
        recordError('GATEWAY_RECOVERY_FAILED', e?.message || String(e));
        console.log(JSON.stringify({ ok: false, event: 'AUTO_RECOVERY_ERROR', error: state.last_recovery_error }));
      }
    }
  }

  // B) plugin missing or not loaded
  let pluginOk = true;
  try {
    const livePluginDir = path.join(os.homedir(), '.openclaw', 'extensions', 'a2a-send');
    const pluginDirOk = await fileExists(livePluginDir);

    const pluginsRes = await loadPluginsJson({ execImpl: exec0 });
    if (!pluginsRes.ok) {
      // PATCH 2: CLI failure ≠ system failure
      console.log(JSON.stringify({ ok: true, event: 'AUTO_RECOVERY_SKIPPED', reason: 'OPENCLAW_CLI_UNAVAILABLE' }));
    } else {
      const plugins = pluginsRes.json;
      const a2a =
        !!plugins && Array.isArray(plugins.plugins) ? plugins.plugins.find((p) => p && p.id === 'a2a-send') : null;
      const pluginLoaded = !!a2a && a2a.enabled === true && a2a.status === 'loaded' && Number(a2a.httpRoutes || 0) >= 1;
      pluginOk = pluginDirOk && pluginLoaded;

      if (!pluginOk) {
        if (within30mSameAction('PLUGIN_RESYNCED')) {
          console.log(JSON.stringify({ ok: true, event: 'AUTO_RECOVERY_SKIPPED', reason: 'RATE_LIMIT', category: 'plugin' }));
        } else {
          const repoPluginDir = path.join(ws, 'ops', 'openclaw', 'extensions', 'a2a-send');
          await copyDirRecursive(repoPluginDir, livePluginDir);
          // PATCH 3: single-run dedup (skip gateway restart if already restarted)
          if (!gatewayRestartedThisCycle) {
            await restartGatewayDetached({ execImpl: exec0 });
            console.log(JSON.stringify({ ok: true, event: 'AUTO_RECOVERY_GATEWAY_RESTARTED' }));
            gatewayRestartedThisCycle = true;
          }
          console.log(JSON.stringify({ ok: true, event: 'AUTO_RECOVERY_PLUGIN_RESYNCED' }));
          recordAction('PLUGIN_RESYNCED');
        }
      }
    }
  } catch (e) {
    recordError('PLUGIN_RECOVERY_FAILED', e?.message || String(e));
    console.log(JSON.stringify({ ok: false, event: 'AUTO_RECOVERY_ERROR', error: state.last_recovery_error }));
  }

  // A) daemon missing (strict detection)
  let daemonOk = true;
  try {
    const n = await daemonCount({ execImpl: exec0 });
    if (n > 1) {
      daemonOk = true; // system has daemons, but we refuse to spawn more
      console.log(JSON.stringify({ ok: true, event: 'AUTO_RECOVERY_SKIPPED', reason: 'MULTIPLE_DAEMONS_DETECTED', count: n }));
    } else if (n === 0) {
      daemonOk = false;
      if (within30mSameAction('DAEMON_RESTARTED')) {
        console.log(JSON.stringify({ ok: true, event: 'AUTO_RECOVERY_SKIPPED', reason: 'RATE_LIMIT', category: 'daemon' }));
      } else {
        await restartDaemonDetached({ workspace_path: ws, holder: h, execImpl: exec0 });
        console.log(JSON.stringify({ ok: true, event: 'AUTO_RECOVERY_DAEMON_RESTARTED' }));
        recordAction('DAEMON_RESTARTED');
        daemonOk = true; // assume started
      }
    }
  } catch (e) {
    recordError('DAEMON_RECOVERY_FAILED', e?.message || String(e));
    console.log(JSON.stringify({ ok: false, event: 'AUTO_RECOVERY_ERROR', error: state.last_recovery_error }));
  }

  // Runtime state exists + valid JSON (non-destructive signal only)
  let runtimeOk = true;
  try {
    const p = path.join(ws, 'data', 'runtime_state.json');
    if (await fileExists(p)) {
      JSON.parse(await fs.readFile(p, 'utf8'));
    }
  } catch (e) {
    runtimeOk = false;
    // do not auto-recover by clearing state
    recordError('RUNTIME_STATE_INVALID_JSON', e?.message || String(e));
    console.log(JSON.stringify({ ok: false, event: 'AUTO_RECOVERY_ERROR', error: state.last_recovery_error }));
  }

  // PATCH 5: one summary log per cycle
  console.log(
    JSON.stringify({
      ok: true,
      event: 'AUTO_RECOVERY_SUMMARY',
      daemon_ok: daemonOk,
      plugin_ok: pluginOk,
      gateway_ok: gatewayOk,
      runtime_state_ok: runtimeOk,
      action_taken: safeStr(state.last_recovery_action || '') || null
    })
  );

  return { ok: true };
}
