#!/usr/bin/env node
/**
 * Print a fast global network overview.
 * Best-effort: never throws; exits 0.
 */

import { buildGlobalNetworkSnapshotV0_1, formatGlobalNetworkSnapshotV0_1 } from '../src/runtime/network/globalNetworkSnapshotV0_1.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--node-id') out.node_id = argv[++i];
    else if (a === '--top') out.top = Number(argv[++i]);
    else if (a === '--agents-url') out.agents_url = argv[++i];
    else if (a === '--peers-url') out.peers_url = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const snap = await buildGlobalNetworkSnapshotV0_1({
    selfNodeId: args.node_id || null,
    remoteAgentsUrl: args.agents_url || 'https://bootstrap.a2a.fun/agents',
    remotePeersUrl: args.peers_url || 'https://bootstrap.a2a.fun/peers'
  }).catch((e) => ({ ok: false, error: String(e?.message || e) }));

  // Always print *something*, per spec.
  if (snap && snap.ok) {
    console.log(formatGlobalNetworkSnapshotV0_1(snap, { topN: Number.isFinite(args.top) ? args.top : 8 }));
    // machine-safe footer for debugging (kept short)
    if (process.env.A2A_SNAPSHOT_DEBUG === '1') {
      console.log('');
      console.log(`data_source_used=${snap.data_source_used}`);
    }
  } else {
    console.log('🌐 A2A NETWORK ONLINE');
    console.log('');
    console.log('Total nodes: unknown');
    console.log('');
    console.log('Top regions:');
    console.log('');
    console.log('🌍 Unknown: unknown');
  }
}

await main();
process.exit(0);
