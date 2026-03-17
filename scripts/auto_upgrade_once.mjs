#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getRuntimeStatePath, loadRuntimeState, saveRuntimeState } from '../src/runtime/agentRuntimeLoop.mjs';
import { checkAndMaybeAutoUpgrade } from '../src/runtime/autoUpgrade.mjs';

function parseArgs(argv) {
  const out = {
    workspace: process.env.A2A_WORKSPACE_PATH || process.cwd(),
    holder: process.env.A2A_AGENT_ID || process.env.NODE_ID || '',
    checkEveryHours: 6
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--workspace') out.workspace = argv[++i] || out.workspace;
    else if (a === '--holder') out.holder = argv[++i] || out.holder;
    else if (a === '--every-hours') out.checkEveryHours = Number(argv[++i] || out.checkEveryHours);
  }
  return out;
}

const args = parseArgs(process.argv);

const state_path = getRuntimeStatePath({ workspace_path: args.workspace });
const loaded = await loadRuntimeState({ state_path });
const state = loaded.state;

const res = await checkAndMaybeAutoUpgrade({
  workspace_path: args.workspace,
  holder: args.holder,
  state,
  state_path,
  checkEveryHours: args.checkEveryHours
});

// Ensure state is persisted even on skipped paths.
await saveRuntimeState({ state_path, state }).catch(() => null);

console.log(JSON.stringify(res, null, 2));
