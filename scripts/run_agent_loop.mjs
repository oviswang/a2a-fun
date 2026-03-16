#!/usr/bin/env node
import { runLoop } from '../src/runtime/agentRuntimeLoop.mjs';

function parseArgs(argv) {
  const out = { once: false, daemon: false, holder: null, relay: 'http://127.0.0.1:18884', directory: 'https://bootstrap.a2a.fun', relayUrl: 'wss://bootstrap.a2a.fun/relay' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--once') out.once = true;
    else if (a === '--daemon') out.daemon = true;
    else if (a === '--holder') out.holder = argv[++i] || null;
    else if (a === '--relay') out.relay = argv[++i] || out.relay;
    else if (a === '--directory') out.directory = argv[++i] || out.directory;
    else if (a === '--relayUrl') out.relayUrl = argv[++i] || out.relayUrl;
  }
  return out;
}

const args = parseArgs(process.argv);
const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();

const out = await runLoop({
  workspace_path,
  once: args.once,
  daemon: args.daemon,
  holder: args.holder,
  relay: args.relay,
  directory: args.directory,
  relayUrl: args.relayUrl
});

console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
