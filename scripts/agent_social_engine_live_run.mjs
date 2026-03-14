import * as sharedClient from '../src/discovery/sharedAgentDirectoryClient.mjs';
import { runAgentSocialEngineLiveRun } from '../src/social/agentSocialEngineLiveRun.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    } else {
      out._.push(a);
    }
  }
  return out;
}

const args = parseArgs(process.argv);

const base_url = typeof args.baseUrl === 'string' ? args.baseUrl : 'https://bootstrap.a2a.fun';
const workspace_path = typeof args.workspace === 'string' ? args.workspace : process.cwd();
const agent_id = typeof args.agentId === 'string' ? args.agentId : (process.env.A2A_AGENT_ID || require('node:os').hostname());

// Observable send: print machine-safe JSON line.
async function send({ gateway, channel_id, message }) {
  console.log(JSON.stringify({ ok: true, event: 'feed_send', gateway, channel_id, message }));
  return { ok: true };
}

const context = { channel: 'telegram', chat_id: 'local' };

const out = await runAgentSocialEngineLiveRun({
  base_url,
  workspace_path,
  agent_id,
  sharedClient,
  send,
  context
});

console.log(JSON.stringify(out));
