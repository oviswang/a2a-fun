import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { verifyReleaseManifest } from './security/verifyRelease.mjs';

const execFileAsync = promisify(execFile);

function safeStr(v) {
  return typeof v === 'string' ? v.trim() : '';
}

async function readJsonSafe(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(String(raw || ''));
  } catch {
    return null;
  }
}

async function gitDescribe({ cwd }) {
  try {
    const { stdout } = await execFileAsync('git', ['describe', '--tags', '--always'], { cwd });
    return safeStr(stdout);
  } catch {
    return '';
  }
}

async function gitHead({ cwd }) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });
    return safeStr(stdout);
  } catch {
    return '';
  }
}

async function fetchVerifiedReleaseManifest({ url }) {
  try {
    const r = await fetch(url, { method: 'GET' });
    if (!r.ok) return { ok: false, reason: 'HTTP', status: r.status, manifest: null };
    const manifest = await r.json().catch(() => null);
    if (!manifest || typeof manifest !== 'object') return { ok: false, reason: 'JSON', status: r.status, manifest: null };
    const ver = verifyReleaseManifest(manifest);
    if (!ver.ok) return { ok: false, reason: ver.reason || 'VERIFY', status: r.status, manifest };
    return { ok: true, manifest };
  } catch (e) {
    return { ok: false, reason: 'FETCH', error: String(e?.message || e), manifest: null };
  }
}

/**
 * Normalized, user-facing version info.
 * Priority (user-trustable):
 *  a) current git tag/describe
 *  b) verified release.json version
 *  c) git commit
 *  d) package.json version (last resort only)
 */
export async function getNormalizedVersionInfo({
  workspace_path = null,
  release_manifest_url = null
} = {}) {
  const ws = workspace_path || process.env.A2A_WORKSPACE_PATH || process.cwd();

  const git_tag = await gitDescribe({ cwd: ws });
  const git_commit = await gitHead({ cwd: ws });

  const relUrl = safeStr(release_manifest_url) || safeStr(process.env.RELEASE_MANIFEST_URL) || 'https://a2a.fun/release.json';
  const rel = await fetchVerifiedReleaseManifest({ url: relUrl });
  const release_version = rel.ok ? safeStr(rel.manifest?.version) || null : null;

  let package_version = null;
  try {
    const pkg = await readJsonSafe(path.join(ws, 'package.json'));
    package_version = pkg?.version ? safeStr(String(pkg.version)) : null;
  } catch {}

  const parts = [];
  if (git_tag) parts.push('git_tag');
  if (release_version) parts.push('release_manifest');
  if (!parts.length && git_commit) parts.push('git_commit');
  if (!parts.length && package_version) parts.push('package_json');

  const current_version = git_tag || release_version || (git_commit ? git_commit.slice(0, 7) : '') || package_version || 'unknown';

  return {
    current_version,
    release_version,
    git_commit: git_commit || null,
    version_source: parts.join('+') || 'unknown',
    // keep for debugging; should NOT be presented as primary version
    package_version: package_version || null,
    release_manifest_verified: rel.ok === true
  };
}
