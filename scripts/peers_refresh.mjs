#!/usr/bin/env node
import { discoverPeers } from '../src/peers/discoverPeers.mjs';
import { getPeersPath, savePeers } from '../src/peers/peerStore.mjs';

function parseArgs(argv) {
  const out = { directory_base_url: 'https://bootstrap.a2a.fun', relay_local_http: 'http://127.0.0.1:18884' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--directory') out.directory_base_url = argv[++i] || out.directory_base_url;
    else if (a === '--relay') out.relay_local_http = argv[++i] || out.relay_local_http;
  }
  return out;
}

const args = parseArgs(process.argv);
const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();

const out = await discoverPeers({ workspace_path, directory_base_url: args.directory_base_url, relay_local_http: args.relay_local_http });
if (!out.ok) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

const peers_path = getPeersPath({ workspace_path });
await savePeers({ peers_path, table: out.table });

console.log(JSON.stringify({
  ok: true,
  peers_path,
  stats: out.stats
}, null, 2));
