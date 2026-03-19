#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function stableStringify(obj) {
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(obj));
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const out = { version: null, git_commit: null, outPath: 'release.json' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--version') out.version = argv[++i] || null;
    else if (a === '--git_commit') out.git_commit = argv[++i] || null;
    else if (a === '--out') out.outPath = argv[++i] || out.outPath;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const version = String(args.version || '').trim();
  const git_commit = String(args.git_commit || '').trim();
  if (!/^v\d+\.\d+\.\d+$/.test(version)) throw new Error('bad --version');
  if (!/^[0-9a-f]{7,40}$/i.test(git_commit)) throw new Error('bad --git_commit');

  const privPath = String(process.env.RELEASE_PRIVATE_KEY_PATH || '').trim();
  if (!privPath) throw new Error('missing RELEASE_PRIVATE_KEY_PATH');

  const skillPath = path.join(process.cwd(), 'skill.md');
  const skillBuf = await fs.readFile(skillPath);
  const skillHash = 'sha256:' + sha256Hex(skillBuf);

  const release = {
    version,
    channel: 'stable',
    release_type: 'stable',
    git_tag: `${version}-stable`,
    git_commit,
    min_required_version: 'v0.5.0',
    skill_md_hash: skillHash,
    released_at: nowIso()
  };

  const msg = stableStringify(release);
  const privPem = await fs.readFile(privPath, 'utf8');
  const sig = crypto.sign(null, Buffer.from(msg, 'utf8'), privPem);

  const releaseSigned = { ...release, signature: sig.toString('base64') };

  const outJson = stableStringify(releaseSigned);
  await fs.writeFile(args.outPath, outJson + '\n', 'utf8');
  console.log(outJson);
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
