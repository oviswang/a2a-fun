#!/usr/bin/env node
// Minimal release signing tool (integrity only).
// Signs the SAME canonical payload that nodes verify:
//   stableStringify({ ...manifest_without_signature })
// using the embedded release public key trust model.

import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalReleasePayload } from '../src/runtime/security/verifyRelease.mjs';

const execFileP = promisify(execFile);

function nowIso(){ return new Date().toISOString(); }
function jlog(obj){ process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }

async function gitHead(){
  const { stdout } = await execFileP('git', ['rev-parse', 'HEAD']);
  return String(stdout).trim();
}

async function readJson(p){
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(String(raw));
}

async function writeJsonAtomic(p,obj){
  const tmp = `${p}.tmp.${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, p);
}

function sha256Hex(buf){
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function parseHashField(s){
  const v = String(s || '').trim();
  if (v.startsWith('sha256:')) return v.slice('sha256:'.length);
  return v;
}

function canonicalCommit(man){
  return String(man?.git_commit_hash || man?.git_commit || '').trim() || null;
}

async function main(){
  const repoRoot = process.cwd();
  const releasePath = path.join(repoRoot, 'release.json');
  const skillPath = path.join(repoRoot, 'skill.md');

  const defaultPrivPath = path.join(process.env.HOME || '/home/ubuntu', '.a2a-release-keys', 'release_ed25519_private.pem');
  const privPath = String(process.env.RELEASE_PRIVKEY_PATH || defaultPrivPath).trim();
  if (!privPath) throw new Error('MISSING_RELEASE_PRIVKEY_PATH');

  const man = await readJson(releasePath);
  const commit = canonicalCommit(man);
  if (!commit) throw new Error('MISSING_git_commit_hash');

  // Fail-closed: ensure we are signing for the current repo HEAD.
  const head = await gitHead();
  if (head !== commit) throw new Error(`GIT_COMMIT_MISMATCH head=${head} release=${commit}`);

  // Fail-closed: skill.md hash must match manifest before signing.
  const skillRaw = await fs.readFile(skillPath);
  const gotHex = sha256Hex(skillRaw);
  const wantHex = parseHashField(String(man.skill_md_hash || '').trim());
  if (!wantHex) throw new Error('MISSING_skill_md_hash');
  if (gotHex !== wantHex) throw new Error(`SKILL_MD_HASH_MISMATCH want=sha256:${wantHex} got=sha256:${gotHex}`);

  // Canonical payload matches node-side verifier.
  const msg = canonicalReleasePayload(man);

  const privPem = await fs.readFile(privPath, 'utf8');
  const privKey = crypto.createPrivateKey(String(privPem));
  const sig = crypto.sign(null, Buffer.from(msg, 'utf8'), privKey);
  const sigB64 = sig.toString('base64');

  const next = { ...man, signature: sigB64, build_ts: man.build_ts || nowIso() };
  await writeJsonAtomic(releasePath, next);

  jlog({
    ok: true,
    ts: nowIso(),
    signed: true,
    release_json: releasePath,
    private_key: privPath,
    payload_preview: msg.slice(0, 160) + '...',
    signature_b64_prefix: sigB64.slice(0, 12) + '...'
  });
}

main().catch((e)=>{
  jlog({ ok:false, ts: nowIso(), event:'RELEASE_SIGN_FAILED', reason: String(e?.message || e) });
  process.exit(1);
});
