#!/usr/bin/env node
import { buildInvestigationThreads } from '../src/experience/investigationThreadBuilder.mjs';

function parseArgs(argv) {
  const out = { aggregate: null, window: 'last_24h' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--aggregate') out.aggregate = argv[++i] || null;
    else if (a === '--window') out.window = argv[++i] || out.window;
  }
  return out;
}

const args = parseArgs(process.argv);
const res = await buildInvestigationThreads({ aggregate_path: args.aggregate, window: args.window });
console.log(JSON.stringify(res, null, 2));
