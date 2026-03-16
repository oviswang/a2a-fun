#!/usr/bin/env node
import { buildNetworkMetrics } from '../src/observability/networkMetrics.mjs';

function parseArgs(argv) {
  const out = { activeWindowSeconds: 600 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--active-window-seconds') out.activeWindowSeconds = parseInt(argv[++i] || '600', 10);
  }
  return out;
}

const args = parseArgs(process.argv);
const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();
const out = await buildNetworkMetrics({ workspace_path, active_window_seconds: args.activeWindowSeconds });
console.log(JSON.stringify(out.metrics, null, 2));
