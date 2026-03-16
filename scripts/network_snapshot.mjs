#!/usr/bin/env node
import { buildNetworkSnapshot } from '../src/observability/networkSnapshot.mjs';

const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();
const out = await buildNetworkSnapshot({ workspace_path });
console.log(JSON.stringify(out.snapshot, null, 2));
