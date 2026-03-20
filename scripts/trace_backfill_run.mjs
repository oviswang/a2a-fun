#!/usr/bin/env node

import path from 'node:path';
import { runTraceBackfill } from '../src/analytics/traceBackfill.mjs';

function parseArgs(argv) {
  const out = { windowHours: 24, maxEvents: 2000 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--window-hours') out.windowHours = Number(argv[++i] || 24);
    else if (a === '--max-events') out.maxEvents = Number(argv[++i] || 2000);
  }
  return out;
}

const args = parseArgs(process.argv);
const ws = process.env.A2A_WORKSPACE_PATH ? String(process.env.A2A_WORKSPACE_PATH).trim() : process.cwd();
const res = runTraceBackfill({ dataDir: path.join(ws, 'data'), windowHours: args.windowHours, maxEvents: args.maxEvents });
process.stdout.write(JSON.stringify(res, null, 2) + '\n');
