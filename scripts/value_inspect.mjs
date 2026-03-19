#!/usr/bin/env node

import { getValue } from '../src/value/value.mjs';

const sid = String(process.argv[2] || '').trim();
if (!sid) {
  process.stderr.write('Usage: node scripts/value_inspect.mjs sid-...\n');
  process.exit(2);
}

process.stdout.write(JSON.stringify(getValue(sid), null, 2) + '\n');
