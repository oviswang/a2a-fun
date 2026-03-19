#!/usr/bin/env node
// Usage:
// node scripts/identity_merge.mjs --target sid-xxx --source telegram:123 --source whatsapp:+659...

import { mergeIdentity } from '../src/identity/superIdentity.mjs';

function parseArgs(argv) {
  const out = { target: null, sources: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') out.target = String(argv[++i] || '');
    if (a === '--source') out.sources.push(String(argv[++i] || ''));
  }
  return out;
}

const { target, sources } = parseArgs(process.argv);

const parsed = sources
  .map((s) => {
    const [channel, ...rest] = String(s).split(':');
    const user_id = rest.join(':');
    return { channel, user_id };
  })
  .filter((x) => x.channel && x.user_id);

const res = mergeIdentity({ sources: parsed, target_super_identity_id: target });
process.stdout.write(JSON.stringify(res, null, 2) + '\n');
