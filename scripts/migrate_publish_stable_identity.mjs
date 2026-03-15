#!/usr/bin/env node
import os from 'node:os';

import { listPublishedAgentsRemote, publishAgentCardRemote } from '../src/discovery/sharedAgentDirectoryClient.mjs';
import { extractAgentDiscoveryDocuments } from '../src/discovery/agentDocumentExtractor.mjs';
import { buildAgentCardFromDocuments } from '../src/discovery/agentCardBuilder.mjs';
import { resolveStableAgentIdentity } from '../src/identity/stableIdentityRuntime.mjs';
import { isStableAgentId } from '../src/identity/stableAgentId.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseUrl') out.baseUrl = argv[++i];
    else if (a === '--workspace') out.workspace = argv[++i];
    else if (a === '--agentSlug') out.agentSlug = argv[++i];
  }
  return out;
}

function machineSafeSummary(s) {
  try {
    console.log(JSON.stringify(s));
  } catch {
    console.log('{"ok":false,"error":"LOG_FAIL"}');
  }
}

const args = parseArgs(process.argv);
const base_url = args.baseUrl || process.env.A2A_BOOTSTRAP_URL || 'https://bootstrap.a2a.fun';
const workspace_path = args.workspace || process.env.A2A_WORKSPACE_PATH || '';
const agent_slug = args.agentSlug || process.env.A2A_AGENT_SLUG || 'default';

const legacy_agent_id = (process.env.A2A_AGENT_ID || '').trim() || os.hostname();

const principalCtx = {
  gateway: (process.env.A2A_PRINCIPAL_GATEWAY || '').trim() || null,
  account_id: (process.env.A2A_PRINCIPAL_ACCOUNT_ID || '').trim() || null
};

const stable = resolveStableAgentIdentity({ context: principalCtx, agent_slug });

const listOut = await listPublishedAgentsRemote({ base_url });
if (!listOut.ok) {
  machineSafeSummary({ ok: false, base_url, error: listOut.error || { code: 'LIST_FAILED' } });
  process.exit(1);
}

const agents = Array.isArray(listOut.agents) ? listOut.agents : [];
const ids = agents.map((a) => (a && typeof a.agent_id === 'string' ? a.agent_id.trim() : '')).filter(Boolean);

const total_agents = ids.length;
const stable_agents = ids.filter((id) => isStableAgentId(id)).length;
const legacy_agents = total_agents - stable_agents;

let republished = 0;

if (stable.ok && stable.stable_agent_id) {
  const already = ids.includes(stable.stable_agent_id);
  if (!already) {
    // Re-publish THIS node using the stable id.
    const docsOut = await extractAgentDiscoveryDocuments({ workspace_path });
    if (docsOut.ok) {
      const cardOut = buildAgentCardFromDocuments({ documents: docsOut.documents, agent_id: stable.stable_agent_id });
      if (cardOut.ok) {
        const pubOut = await publishAgentCardRemote({ base_url, agent_id: stable.stable_agent_id, card: cardOut.agent_card });
        if (pubOut.ok) republished = 1;
      }
    }
  }
}

machineSafeSummary({
  ok: true,
  base_url,
  total_agents,
  stable_agents,
  legacy_agents,
  republished,
  stable_resolvable: stable.ok === true,
  stable_agent_id: stable.ok ? stable.stable_agent_id : null,
  legacy_agent_id
});
