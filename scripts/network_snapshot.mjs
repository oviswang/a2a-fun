#!/usr/bin/env node
/**
 * CLI entrypoint for NETWORK_SNAPSHOT (V0.1)
 * Usage:
 *   node scripts/network_snapshot.mjs
 *   node scripts/network_snapshot.mjs --json
 */

import { getNetworkSnapshot, formatNetworkSnapshotHuman } from '../src/runtime/network/networkSnapshotV0_1.mjs';

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');

const snap = await getNetworkSnapshot({}).catch((e) => ({ ok: false, error: String(e?.message || e) }));

if (!snap || snap.ok !== true) {
  if (asJson) console.log(JSON.stringify(snap || { ok: false, error: 'snapshot_failed' }, null, 2));
  else console.log('🌐 A2A NETWORK\n\nTotal nodes: unknown\n\n🟢 Active peers:\n- (unavailable)\n\nYou are: unknown');
  process.exit(1);
}

if (asJson) {
  console.log(JSON.stringify(snap, null, 2));
} else {
  console.log(formatNetworkSnapshotHuman(snap));
}
