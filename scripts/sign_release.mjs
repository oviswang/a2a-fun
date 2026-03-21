#!/usr/bin/env node
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

function nowIso(){ return new Date().toISOString(); }
function jlog(obj){ process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }

function sha256Hex(buf){
  return crypto.createHash('sha256').update(buf).digest('hex');
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

function parseHashField(s){
  const v = String(s || '').trim();
  if (v.startsWith('sha256:')) return v.slice('sha256:'.length);
  return v;
}

function canonicalCommit(man){
  return String(man?.git_commit_hash || man?.git_commit || '').trim() || null;
}

function canonicalVersion(man){
  return String(man?.version || '').trim() || null;
}

function messageToSign({ version, commit, skillHashHex }){
  return `${version}|${commit}|sha256:${skillHashHex}`;
}

async function gitHead(){
  const { stdout } = await execFileP('git', ['rev-parse', 'HEAD']);
  return String(stdout).trim();
}

async function ensureKeypair({ pubPath, privPath }){
  const privPem = await fs.readFile(privPath, 'utf8').catch(()=>null);
  if (privPem && String(privPem).trim()) {
    const pub = await readJson(pubPath).catch(()=>null);
    if (pub?.publicKeyPem) return { privPem: String(privPem), pubPem: String(pub.publicKeyPem) };
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privPem2 = privateKey.export({ type: 'pkcs8', format: 'pem' });

  await fs.mkdir(path.dirname(privPath), { recursive: true });
  await fs.writeFile(privPath, privPem2, { mode: 0o600 });

  await fs.mkdir(path.dirname(pubPath), { recursive: true });
  await writeJsonAtomic(pubPath, { ok: true, kty: 'ed25519', publicKeyPem: pubPem });

  return { privPem: privPem2, pubPem };
}

async function main(){
  const repoRoot = process.cwd();
  const releasePath = path.join(repoRoot, 'release.json');
  const skillPath = path.join(repoRoot, 'skill.md');
  const pubPath = path.join(repoRoot, 'config', 'release_pubkey.json');

  const defaultPrivPath = path.join(process.env.HOME || '/home/ubuntu', '.a2a-release-keys', 'release_ed25519_private.pem');
  const privPath = String(process.env.RELEASE_PRIVKEY_PATH || defaultPrivPath);

  const man = await readJson(releasePath);
  const version = canonicalVersion(man);
  const commit = canonicalCommit(man);

  if (!version) throw new Error('MISSING_version');
  if (!commit) throw new Error('MISSING_git_commit_hash');

  // fail-closed: commit must match HEAD to sign
  const head = await gitHead();
  if (head !== commit) throw new Error(`GIT_COMMIT_MISMATCH head=${head} release=${commit}`);

  const skillRaw = await fs.readFile(skillPath);
  const skillHashHex = sha256Hex(skillRaw);

  const wantHex = parseHashField(String(man.skill_md_hash || '').trim());
  if (!wantHex) throw new Error('MISSING_skill_md_hash');
  if (wantHex !== skillHashHex) {
    throw new Error(`SKILL_MD_HASH_MISMATCH want=sha256:${wantHex} got=sha256:${skillHashHex}`);
  }

  const kp = await ensureKeypair({ pubPath, privPath });
  const privKey = crypto.createPrivateKey(kp.privPem);

  const msg = messageToSign({ version, commit, skillHashHex });
  const sig = crypto.sign(null, Buffer.from(msg, 'utf8'), privKey);
  const sigB64 = sig.toString('base64');

  const next = { ...man, signature: sigB64, build_ts: man.build_ts || nowIso() };
  await writeJsonAtomic(releasePath, next);

  jlog({
    ok: true,
    ts: nowIso(),
    signed: true,
    release_json: releasePath,
    public_key: pubPath,
    private_key: privPath,
    message: msg,
    signature_b64_prefix: sigB64.slice(0, 12) + '...'
  });
}

main().catch((e)=>{
  jlog({ ok:false, ts: nowIso(), event:'RELEASE_SIGN_FAILED', reason: String(e?.message || e) });
  process.exit(1);
});
