#!/usr/bin/env node

import { pollPickupLoop } from '../src/market/pullModel.mjs';

const ac = new AbortController();
process.on('SIGINT', () => ac.abort());
process.on('SIGTERM', () => ac.abort());

const intervalMs = Number(process.env.A2A_PULL_INTERVAL_MS || 15000);
const out = await pollPickupLoop({ intervalMs, signal: ac.signal, node_id: process.env.NODE_ID || null });
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
