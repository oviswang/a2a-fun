#!/usr/bin/env node
import { buildNetworkAutotune } from '../src/observability/networkAutotune.mjs';

const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();
const out = await buildNetworkAutotune({ workspace_path });
console.log(JSON.stringify(out.autotune, null, 2));
