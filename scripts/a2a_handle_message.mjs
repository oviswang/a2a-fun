#!/usr/bin/env node
// Failsafe execution bridge:
// cat inbound.json | node scripts/a2a_handle_message.mjs --channel telegram

import fs from 'node:fs';
import { getAdapter } from '../src/channels/adapterRegistry.mjs';
import { a2aCoreHandleMessage } from '../src/core/a2aCore.mjs';

function parseArgs(argv) {
  const out = { channel: 'openclaw' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--channel') out.channel = String(argv[++i] || 'openclaw');
  }
  return out;
}

const { channel } = parseArgs(process.argv);
const adapter = getAdapter(channel);
if (!adapter) {
  console.error(JSON.stringify({ ok: false, error: 'adapter_not_found', channel }));
  process.exit(2);
}

let raw = '';
try {
  raw = fs.readFileSync(0, 'utf8');
} catch {
  raw = '';
}

let inbound;
try {
  inbound = raw ? JSON.parse(raw) : {};
} catch {
  inbound = { text: raw };
}

const standard = adapter.normalizeInbound(inbound);
const result = await a2aCoreHandleMessage(standard);
const outbound = adapter.formatOutbound({ result });
process.stdout.write(JSON.stringify({ ok: true, standard, result, outbound }, null, 2));
