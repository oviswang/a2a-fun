#!/usr/bin/env node
import fs from 'node:fs/promises';
import { generateRadar } from '../src/observability/radarGenerator.mjs';

function parseArgs(argv) {
  const out = {
    aggregate: null,
    out: 'radar.json'
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--aggregate') out.aggregate = argv[++i] || null;
    else if (a === '--out') out.out = argv[++i] || out.out;
  }
  return out;
}

const args = parseArgs(process.argv);

const radar = await generateRadar({ aggregate_path: args.aggregate });

// Always emit machine-safe JSON to stdout
console.log(JSON.stringify(radar, null, 2));

// Best-effort write to file when ok
if (radar.ok && args.out) {
  await fs.writeFile(String(args.out), JSON.stringify(radar, null, 2) + '\n', 'utf8');
}
