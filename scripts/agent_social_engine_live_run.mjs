import * as sharedClient from '../src/discovery/sharedAgentDirectoryClient.mjs';
import { runAgentSocialEngineLiveRun } from '../src/social/agentSocialEngineLiveRun.mjs';
import { createOpenClawCliSend } from '../src/social/openclawCliSend.mjs';

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

// Real send: dispatch via local OpenClaw gateway runtime (through the OpenClaw CLI).
// Best-effort behavior is preserved by the caller (social feed hook swallows failures).
const send = createOpenClawCliSend({ openclawBin: process.env.OPENCLAW_BIN || 'openclaw' });

// Default to an actually user-facing gateway target for this host.
// Override with env vars for other surfaces.
//
// Examples:
//   A2A_SOCIAL_GATEWAY=telegram A2A_SOCIAL_CHANNEL_ID=7095719535 node scripts/agent_social_engine_live_run.mjs
//   A2A_SOCIAL_GATEWAY=whatsapp A2A_SOCIAL_CHANNEL_ID=+15555550123 node scripts/agent_social_engine_live_run.mjs
const context = {
  channel: process.env.A2A_SOCIAL_GATEWAY || process.env.A2A_SOCIAL_CHANNEL || 'whatsapp',
  chat_id: process.env.A2A_SOCIAL_CHANNEL_ID || process.env.A2A_SOCIAL_CHAT_ID || '+6598931276'
};

const out = await runAgentSocialEngineLiveRun({
  base_url,
  workspace_path,
  agent_id,
  sharedClient,
  send,
  context
});

console.log(JSON.stringify(out));
