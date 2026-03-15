#!/usr/bin/env node
import { listLocalAgentMemory } from '../src/memory/localAgentMemory.mjs';

const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();

const out = await listLocalAgentMemory({ workspace_path });
console.log(JSON.stringify(out));
