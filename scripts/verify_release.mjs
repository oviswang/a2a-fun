#!/usr/bin/env node
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileP = promisify(execFile);

function nowIso(){ return new Date().toISOString(); }
function jlog(obj){ process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }

async function readJson(p){
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(String(raw));
}

function sha256Hex(buf){
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function parseHashField(s){
  const v = String(s || '').trim();
  if (v.startsWith('sha256:')) return v.slice('sha256:'.length);
  return v;
}

async function gitHead(){
  const { stdout } = await execFileP('git', ['rev-parse', 'HEAD']);
  return String(stdout).trim();
}

async function gitExactTag(){
  try {
    const { stdout } = await execFileP('git', ['describe', '--tags', '--exact-match']);
    return String(stdout).trim();
  } catch {
    return null;
  }
}

function canonicalCommit(man){
  return String(man?.git_commit_hash || man?.git_commit || '').trim() || null;
}

function canonicalSkillHash(man){
  return String(man?.skill_md_hash || '').trim() || null;
}

function canonicalVersion(man){
  return String(man?.version || '').trim() || null;
}

function loadPubkey(pub){
  const pem = String(pub?.publicKeyPem || '').trim();
  if (!pem) throw new Error('MISSING_PUBLIC_KEY_PEM');
  return crypto.createPublicKey(pem);
}

function verifySig({ version, commit, skillHashHex, signatureB64, pubKey }){
  const msg = `${version}|${commit}|sha256:${skillHashHex}`;
  const sig = Buffer.from(String(signatureB64), 'base64');
  return crypto.verify(null, Buffer.from(msg, 'utf8'), pubKey, sig);
}

async function main(){
  const repoRoot = process.cwd();
  const releasePath = path.join(repoRoot, 'release.json');
  const skillPath = path.join(repoRoot, 'skill.md');
  const pubPath = path.join(repoRoot, 'config', 'release_pubkey.json');

  const out = {
    ts: nowIso(),
    signature_ok: false,
    hash_match: false,
    tag_match: false,
    overall_ok: false,
    details: {}
  };

  let man;
  try { man = await readJson(releasePath); }
  catch (e) {
    out.details.error = { event: 'RELEASE_VERIFICATION_FAILED', reason: 'RELEASE_JSON_READ_FAILED', message: String(e?.message || e) };
    jlog(out);
    process.exit(2);
  }

  const version = canonicalVersion(man);
  const commit = canonicalCommit(man);
  const wantHex = parseHashField(canonicalSkillHash(man));
  const sigB64 = String(man?.signature || '').trim();

  if (!version || !commit || !wantHex || !sigB64) {
    out.details.error = { event: 'RELEASE_VERIFICATION_FAILED', reason: 'MISSING_REQUIRED_FIELDS', missing: { version: !version, git_commit_hash: !commit, skill_md_hash: !wantHex, signature: !sigB64 } };
    jlog(out);
    process.exit(1);
  }

  const head = await gitHead();
  const tag = await gitExactTag();
  const skillRaw = await fs.readFile(skillPath);
  const gotHex = sha256Hex(skillRaw);

  out.hash_match = (gotHex === wantHex);
  out.tag_match = (!!tag && (tag === version || tag === String(man.git_tag || '').trim()));
  out.details.head = head;
  out.details.release_commit = commit;
  let headParent = null;
  let headGrandParent = null;
  try { headParent = String((await execFileP("git", ["rev-parse", "HEAD^"])).stdout).trim(); } catch {}
  try { headGrandParent = String((await execFileP("git", ["rev-parse", "HEAD^^"])).stdout).trim(); } catch {}
  out.details.head_parent = headParent;
  out.details.head_grandparent = headGrandParent;
  out.details.commit_match = (head === commit) || (headParent && headParent === commit) || (headGrandParent && headGrandParent === commit);
  out.details.exact_tag = tag;
  out.details.version = version;
  out.details.skill_hash_got = `sha256:${gotHex}`;
  out.details.skill_hash_want = `sha256:${wantHex}`;

  try {
    const pub = await readJson(pubPath);
    const pubKey = loadPubkey(pub);
    out.signature_ok = verifySig({ version, commit, skillHashHex: gotHex, signatureB64: sigB64, pubKey });
  } catch (e) {
    out.signature_ok = false;
    out.details.error = { event: 'RELEASE_VERIFICATION_FAILED', reason: 'SIGNATURE_VERIFY_ERROR', message: String(e?.message || e) };
  }

  out.overall_ok = !!(out.signature_ok && out.hash_match && out.tag_match && out.details.commit_match);
  if (!out.overall_ok) {
    out.details.fail_closed = { event: 'RELEASE_VERIFICATION_FAILED', not_trusted: true };
  }

  jlog(out);
  process.exit(out.overall_ok ? 0 : 1);
}

main().catch((e)=>{
  jlog({ ts: nowIso(), event:'RELEASE_VERIFICATION_FAILED', reason:'UNCAUGHT_EXCEPTION', message: String(e?.message || e) });
  process.exit(2);
});
