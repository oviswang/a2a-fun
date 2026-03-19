import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyReleaseManifest } from '../security/verifyRelease.mjs';

const execFileAsync = promisify(execFile);

function nowIso() {
  return new Date().toISOString();
}

function log(event, fields = {}) {
  console.log(JSON.stringify({ ok: true, event, ts: nowIso(), ...fields }));
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

async function writeJsonAtomic(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, p);
}

async function readJsonSafe(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(String(raw || ''));
  } catch {
    return null;
  }
}

async function appendJsonl(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.appendFile(p, JSON.stringify(obj) + '\n', 'utf8');
}

async function fetchTextWithTimeout(url, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), Math.max(1, Number(timeoutMs) || 3000));
  try {
    const r = await fetch(url, { method: 'GET', signal: ac.signal });
    if (!r.ok) return { ok: false, error: { code: 'HTTP', status: r.status } };
    const text = await r.text();
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: { code: 'FETCH_FAILED', message: String(e?.message || e) } };
  } finally {
    clearTimeout(t);
  }
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const r = await fetchTextWithTimeout(url, timeoutMs);
  if (!r.ok) return r;
  try {
    const j = JSON.parse(String(r.text || ''));
    return { ok: true, json: j };
  } catch {
    return { ok: false, error: { code: 'JSON_PARSE_FAILED' } };
  }
}

export async function fetchTargetVersionFromSkill({ skillUrl = 'https://a2a.fun/skill.md', timeoutMs = 3000 } = {}) {
  const r = await fetchTextWithTimeout(skillUrl, timeoutMs);
  if (!r.ok) return { ok: false, error: r.error };
  const m = /\bA2A_VERSION=(v\d+\.\d+\.\d+)\b/.exec(r.text);
  if (!m) return { ok: false, error: { code: 'PARSE_FAILED' } };
  return { ok: true, version: m[1] };
}

async function gitDescribe({ cwd }) {
  const { stdout } = await execFileAsync('git', ['describe', '--tags', '--always'], { cwd });
  return String(stdout || '').trim();
}

async function gitRevParse({ cwd, rev = 'HEAD' } = {}) {
  const { stdout } = await execFileAsync('git', ['rev-parse', rev], { cwd });
  return String(stdout || '').trim();
}

async function execOk(cmd, args, { cwd, timeoutMs = 300000 } = {}) {
  await execFileAsync(cmd, args, { cwd, timeout: timeoutMs });
}

async function safeUnlink(p) {
  try {
    await fs.unlink(p);
  } catch {}
}

async function clearDerivedCaches(ws) {
  const d = path.join(ws, 'data');
  await safeUnlink(path.join(d, 'presence-cache.json'));
  await safeUnlink(path.join(d, 'capability-summary-cache.json'));
  await safeUnlink(path.join(d, 'peers.json'));
}

async function postUpgradeHealthCheck({ ws } = {}) {
  // Minimal, bounded, evidence-based.
  // 1) snapshot works
  try {
    await execOk('node', ['scripts/network_snapshot.mjs', '--json'], { cwd: ws, timeoutMs: 15000 });
  } catch {
    return { ok: false, error: { code: 'SNAPSHOT_FAILED' } };
  }

  // 2) one safe task works (best-effort, bounded)
  try {
    const { stdout } = await execFileAsync(
      'node',
      [
        '-e',
        "import('./examples/capabilities/a2a_run_check.mjs').then(async m=>{const r=await m.a2a_run_check({check_type:'runtime_status'}); console.log(JSON.stringify(r)); process.exit(r?.result?.received?0:2);})"
      ],
      { cwd: ws, timeout: 20000 }
    );
    // require received true
    if (!String(stdout || '').includes('"received":true')) return { ok: false, error: { code: 'TASK_RUNTIME_STATUS_NO_RESPONSE' } };
  } catch {
    return { ok: false, error: { code: 'TASK_RUNTIME_STATUS_FAILED' } };
  }

  // 3) capability_summary works (best-effort)
  try {
    const { stdout } = await execFileAsync(
      'node',
      [
        '-e',
        "import('./examples/capabilities/a2a_run_check.mjs').then(async m=>{const r=await m.a2a_run_check({check_type:'capability_summary'}); console.log(JSON.stringify(r)); process.exit(r?.result?.received?0:2);})"
      ],
      { cwd: ws, timeout: 20000 }
    );
    if (!String(stdout || '').includes('supported_task_types')) return { ok: false, error: { code: 'CAPABILITY_SUMMARY_BAD' } };
  } catch {
    return { ok: false, error: { code: 'CAPABILITY_SUMMARY_FAILED' } };
  }

  return { ok: true };
}

export async function checkAndMaybeAutoUpgradeV0_3_2({ workspace_path, node_id, isBusy = false } = {}) {
  const ws = String(workspace_path || '').trim() || process.cwd();
  const dataDir = path.join(ws, 'data');

  const AUTO_UPGRADE_ENABLED = String(process.env.AUTO_UPGRADE_ENABLED ?? 'true').toLowerCase() === 'true';
  const CHECK_EVERY_MS = Number(process.env.AUTO_UPGRADE_CHECK_EVERY_MS || 1_800_000);
  const MAX_RETRIES = Number(process.env.AUTO_UPGRADE_MAX_RETRIES || 3);
  const BACKOFF_MS = Number(process.env.AUTO_UPGRADE_BACKOFF_MS || 60_000);

  const localVersionPath = path.join(dataDir, 'local_version');
  const upgradeStatePath = path.join(dataDir, 'upgrade_state.json');
  const historyPath = path.join(dataDir, 'upgrade_history.json');

  const state0 = (await readJsonSafe(upgradeStatePath)) || {
    current_version: null,
    target_version: null,
    state: 'steady',
    last_checked_at: null,
    last_upgraded_at: null,
    retry_count: 0,
    last_error: null,
    previous_version: null,
    previous_ref: null,
    release_signature_status: null,
    release_source: null
  };

  // guard: no concurrent
  if (state0.state === 'upgrading' || state0.state === 'rollback') return { ok: true, skipped: true, reason: 'IN_PROGRESS' };

  // schedule
  const last = Date.parse(String(state0.last_checked_at || ''));
  const due = !Number.isFinite(last) || (Date.now() - last) >= CHECK_EVERY_MS;
  if (!due) return { ok: true, skipped: true, reason: 'NOT_DUE' };

  const local_version = isStableTag(state0.current_version) ? state0.current_version : null;
  const local_git = await gitDescribe({ cwd: ws }).catch(() => '');
  const local_commit = await gitRevParse({ cwd: ws, rev: 'HEAD' }).catch(() => '');
  const local_v = local_version || (isStableTag(local_git) ? local_git : null);

  // persist local_version file (best-effort)
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(localVersionPath, JSON.stringify({ ok: true, ts: nowIso(), node_id: node_id || null, version: local_v, git: local_git, commit: local_commit }, null, 2) + '\n', 'utf8').catch(() => {});

  log('UPGRADE_CHECK_STARTED', { node_id: node_id || null, local_version: local_v, local_git, local_commit });

  const override = String(process.env.AUTO_UPGRADE_TARGET_OVERRIDE || '').trim();

  // v0.3.3 signed releases: prefer release.json, fallback to skill.md if unavailable.
  let targetRes = null;
  let releaseSigStatus = 'UNKNOWN';
  let releaseSource = null;

  if (override) {
    targetRes = { ok: true, version: override };
    releaseSource = 'override';
  } else {
    const relUrl = String(process.env.RELEASE_MANIFEST_URL || 'https://a2a.fun/release.json').trim();
    const rel = await fetchJsonWithTimeout(relUrl, 3000);
    if (!rel.ok) {
      log('RELEASE_FETCH_FAILED', { node_id: node_id || null, url: relUrl, error: rel.error || null });
      log('RELEASE_MANIFEST_UNAVAILABLE_FALLBACK', { node_id: node_id || null, url: relUrl, fallback: 'skill.md' });
      targetRes = await fetchTargetVersionFromSkill({});
      releaseSource = 'skill.md';
    } else {
      releaseSource = 'release.json';
      const man = rel.json;
      const v = String(man?.version || '').trim();
      const vr = verifyReleaseManifest(man);
      if (vr.ok) {
        releaseSigStatus = 'VALID';
        log('RELEASE_SIGNATURE_VALID', { node_id: node_id || null, version: v || null });

        // Anti-tamper: verify skill.md hash matches manifest
        const skillUrl = String(process.env.SKILL_MD_URL || 'https://a2a.fun/skill.md').trim();
        const sk = await fetchTextWithTimeout(skillUrl, 3000);
        if (sk.ok) {
          const got = 'sha256:' + sha256Hex(Buffer.from(sk.text || '', 'utf8'));
          const want = String(man?.skill_md_hash || '').trim();
          if (want && got === want) {
            log('SKILL_MD_HASH_MATCH', { node_id: node_id || null });

            // version compatibility gate (optional)
            const minReq = String(man?.min_required_version || '').trim();
            if (minReq && local_v) {
              const mv = parseSemver(minReq);
              const lv2 = parseSemver(local_v);
              if (mv && lv2 && cmp(lv2, mv) < 0) {
                log('MIN_REQUIRED_VERSION_NOT_MET', { node_id: node_id || null, min_required_version: minReq, local_version: local_v });
                targetRes = { ok: false, error: { code: 'MIN_REQUIRED_VERSION_NOT_MET', min_required_version: minReq } };
              } else {
                targetRes = { ok: true, version: v };
              }
            } else {
              targetRes = { ok: true, version: v };
            }
          } else {
            log('SKILL_MD_HASH_MISMATCH', { node_id: node_id || null, want: want || null, got });
            // Block upgrade when hash mismatches
            targetRes = { ok: false, error: { code: 'SKILL_MD_HASH_MISMATCH' } };
          }
        } else {
          // If cannot fetch skill.md, block upgrade (manifest is valid but content cannot be verified)
          targetRes = { ok: false, error: { code: 'SKILL_MD_FETCH_FAILED' } };
        }
      } else {
        releaseSigStatus = 'INVALID';
        log('RELEASE_SIGNATURE_INVALID', { node_id: node_id || null, reason: vr.reason || 'INVALID_SIGNATURE' });
        // Block upgrade when signature invalid
        targetRes = { ok: false, error: { code: 'RELEASE_SIGNATURE_INVALID' } };
      }
    }
  }

  const nextState = { ...state0, state: 'checking', last_checked_at: nowIso(), last_error: null };
  nextState.release_signature_status = releaseSigStatus;
  nextState.release_source = releaseSource;
  if (!targetRes.ok) {
    nextState.state = 'steady';
    nextState.last_error = targetRes.error;
    await writeJsonAtomic(upgradeStatePath, nextState).catch(() => {});
    log('UPGRADE_CHECK_RESULT', { node_id: node_id || null, local_version: local_v, target_version: null, version_check_status: 'FAILED' });
    return { ok: true, checked: true, version_check_status: 'FAILED' };
  }

  const target_version = targetRes.version;
  nextState.target_version = target_version;
  nextState.current_version = local_v;

  log('UPGRADE_CHECK_RESULT', { node_id: node_id || null, local_version: local_v, target_version, version_check_status: 'OK' });

  const lv = parseSemver(local_v);
  const tv = parseSemver(target_version);
  if (!lv || !tv) {
    nextState.state = 'steady';
    await writeJsonAtomic(upgradeStatePath, nextState).catch(() => {});
    return { ok: true, checked: true, version_check_status: 'OK', warning: 'SEMVER_PARSE_FAILED' };
  }

  if (cmp(tv, lv) <= 0) {
    nextState.state = 'steady';
    nextState.retry_count = 0;
    await writeJsonAtomic(upgradeStatePath, nextState).catch(() => {});
    return { ok: true, checked: true, version_check_status: 'OK', upgrade_needed: false };
  }

  // Upgrade needed
  nextState.state = 'upgrade_needed';
  await writeJsonAtomic(upgradeStatePath, nextState).catch(() => {});
  log('UPGRADE_NEEDED', { node_id: node_id || null, local_version: local_v, target_version });

  if (!AUTO_UPGRADE_ENABLED) {
    // Still surface upgrade_needed, but do not apply.
    return { ok: true, checked: true, upgrade_needed: true, deferred: true, reason: 'AUTO_UPGRADE_DISABLED' };
  }

  if (isBusy) {
    log('UPGRADE_SKIPPED_BUSY', { node_id: node_id || null, local_version: local_v, target_version, reason: 'BUSY' });
    return { ok: true, checked: true, upgrade_needed: true, deferred: true };
  }

  // Backoff / retries
  const lastAttempt = Date.parse(String(state0.last_upgraded_at || state0.last_checked_at || ''));
  if (state0.retry_count >= MAX_RETRIES) {
    return { ok: true, checked: true, upgrade_needed: true, skipped: true, reason: 'MAX_RETRIES' };
  }
  if (Number.isFinite(lastAttempt) && (Date.now() - lastAttempt) < BACKOFF_MS) {
    return { ok: true, checked: true, upgrade_needed: true, skipped: true, reason: 'BACKOFF' };
  }

  // Apply upgrade
  const prev_ref = local_commit || 'HEAD';
  const prev_version = local_v;
  const applying = { ...nextState, state: 'upgrading', previous_version: prev_version, previous_ref: prev_ref, retry_count: Number(state0.retry_count || 0) };
  await writeJsonAtomic(upgradeStatePath, applying).catch(() => {});
  await appendJsonl(historyPath, { ok: true, event: 'UPGRADE_APPLY_STARTED', ts: nowIso(), node_id: node_id || null, from: prev_version, to: target_version }).catch(() => {});
  log('UPGRADE_APPLY_STARTED', { node_id: node_id || null, local_version: prev_version, target_version, retry_count: applying.retry_count });

  try {
    await execOk('git', ['fetch', '--tags', 'origin'], { cwd: ws, timeoutMs: 120000 });
    await execOk('git', ['checkout', '-f', target_version], { cwd: ws, timeoutMs: 120000 });
    await execOk('npm', ['install'], { cwd: ws, timeoutMs: 300000 });
    await clearDerivedCaches(ws);

    // Post-upgrade health check (in-process)
    const hc = await postUpgradeHealthCheck({ ws });
    if (!hc.ok) throw Object.assign(new Error('HEALTHCHECK_FAILED'), { code: hc.error?.code || 'HEALTHCHECK_FAILED' });

    const done = { ...applying, state: 'upgraded', current_version: target_version, last_upgraded_at: nowIso(), retry_count: 0, last_error: null };
    await writeJsonAtomic(upgradeStatePath, done).catch(() => {});
    await appendJsonl(historyPath, { ok: true, event: 'UPGRADE_APPLY_OK', ts: nowIso(), node_id: node_id || null, from: prev_version, to: target_version }).catch(() => {});
    log('UPGRADE_APPLY_OK', { node_id: node_id || null, local_version: prev_version, target_version });

    // Controlled restart (systemd will respawn daemon)
    process.exit(0);
  } catch (e) {
    const err = { code: String(e?.code || 'UPGRADE_FAILED'), message: String(e?.message || e) };
    const failedState = { ...applying, state: 'failed', last_error: err, retry_count: Number(applying.retry_count || 0) + 1, last_upgraded_at: nowIso() };
    await writeJsonAtomic(upgradeStatePath, failedState).catch(() => {});
    await appendJsonl(historyPath, { ok: false, event: 'UPGRADE_APPLY_FAILED', ts: nowIso(), node_id: node_id || null, from: prev_version, to: target_version, error: err }).catch(() => {});
    log('UPGRADE_APPLY_FAILED', { node_id: node_id || null, local_version: prev_version, target_version, retry_count: failedState.retry_count, error: err });

    // Rollback
    const rolling = { ...failedState, state: 'rollback' };
    await writeJsonAtomic(upgradeStatePath, rolling).catch(() => {});
    log('UPGRADE_ROLLBACK_STARTED', { node_id: node_id || null, target_version, previous_ref: prev_ref, previous_version: prev_version });
    try {
      await execOk('git', ['checkout', '-f', prev_ref], { cwd: ws, timeoutMs: 120000 });
      await execOk('npm', ['install'], { cwd: ws, timeoutMs: 300000 });
      await clearDerivedCaches(ws);
      const hc2 = await postUpgradeHealthCheck({ ws });
      if (!hc2.ok) throw Object.assign(new Error('ROLLBACK_HEALTHCHECK_FAILED'), { code: hc2.error?.code || 'ROLLBACK_HEALTHCHECK_FAILED' });

      const rbOk = { ...rolling, state: 'failed', current_version: prev_version, last_error: err };
      await writeJsonAtomic(upgradeStatePath, rbOk).catch(() => {});
      await appendJsonl(historyPath, { ok: true, event: 'UPGRADE_ROLLBACK_OK', ts: nowIso(), node_id: node_id || null, back_to: prev_ref }).catch(() => {});
      log('UPGRADE_ROLLBACK_OK', { node_id: node_id || null, back_to: prev_ref, back_to_version: prev_version });
      process.exit(0);
    } catch (e2) {
      const err2 = { code: String(e2?.code || 'ROLLBACK_FAILED'), message: String(e2?.message || e2) };
      await appendJsonl(historyPath, { ok: false, event: 'UPGRADE_ROLLBACK_FAILED', ts: nowIso(), node_id: node_id || null, error: err2 }).catch(() => {});
      log('UPGRADE_ROLLBACK_FAILED', { node_id: node_id || null, error: err2 });
      return { ok: false, error: err2 };
    }
  }
}
