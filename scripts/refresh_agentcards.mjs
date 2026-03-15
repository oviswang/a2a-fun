#!/usr/bin/env node
import os from 'node:os';

import { listPublishedAgentsRemote, publishAgentCardRemote } from '../src/discovery/sharedAgentDirectoryClient.mjs';
import { extractAgentDiscoveryDocuments } from '../src/discovery/agentDocumentExtractor.mjs';
import { buildAgentCardFromDocuments } from '../src/discovery/agentCardBuilder.mjs';
import { introspectLocalCapabilities } from '../src/discovery/agentCapabilityIntrospector.mjs';
import { resolveStableAgentIdentity } from '../src/identity/stableIdentityRuntime.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseUrl') out.baseUrl = argv[++i];
    else if (a === '--workspace') out.workspace = argv[++i];
    else if (a === '--localBaseUrl') out.localBaseUrl = argv[++i];
  }
  return out;
}

function safeBool(v) {
  return v === true;
}

function emit(obj) {
  console.log(JSON.stringify(obj));
}

const args = parseArgs(process.argv);
const base_url = args.baseUrl || process.env.A2A_BOOTSTRAP_URL || 'https://bootstrap.a2a.fun';
const workspace_path = args.workspace || process.env.A2A_WORKSPACE_PATH || '';
const local_base_url = args.localBaseUrl || process.env.A2A_LOCAL_BASE_URL || 'http://127.0.0.1:3000';

const legacy_agent_id = (process.env.A2A_AGENT_ID || '').trim() || os.hostname();
const principalCtx = {
  gateway: (process.env.A2A_PRINCIPAL_GATEWAY || '').trim() || null,
  account_id: (process.env.A2A_PRINCIPAL_ACCOUNT_ID || '').trim() || null
};

const stable = resolveStableAgentIdentity({ context: principalCtx, agent_slug: 'default' });
const local_agent_id = stable.ok && stable.stable_agent_id ? stable.stable_agent_id : legacy_agent_id;

const listOut = await listPublishedAgentsRemote({ base_url });
if (!listOut.ok) {
  emit({ ok: false, base_url, local_agent_id, error: listOut.error || { code: 'LIST_FAILED' } });
  process.exit(1);
}

const agents = Array.isArray(listOut.agents) ? listOut.agents : [];
const old_card_present = agents.some((a) => a && a.agent_id === local_agent_id);

// Build enriched card
const docsOut = await extractAgentDiscoveryDocuments({ workspace_path });
if (!docsOut.ok) {
  emit({ ok: false, base_url, local_agent_id, old_card_present, refreshed: false, error: docsOut.error });
  process.exit(1);
}

let caps = [];
try {
  const capOut = await introspectLocalCapabilities({ base_url: local_base_url });
  if (capOut.ok === true && Array.isArray(capOut.capabilities)) caps = capOut.capabilities;
} catch {
  caps = [];
}

const cardOut = buildAgentCardFromDocuments({ documents: docsOut.documents, agent_id: local_agent_id, capabilities: caps });
if (!cardOut.ok) {
  emit({ ok: false, base_url, local_agent_id, old_card_present, refreshed: false, error: cardOut.error });
  process.exit(1);
}

let refreshed = false;
try {
  const pubOut = await publishAgentCardRemote({ base_url, agent_id: local_agent_id, card: cardOut.agent_card });
  refreshed = safeBool(pubOut.ok);
} catch {
  refreshed = false;
}

const c = cardOut.agent_card;
const fields_populated = {
  name: typeof c.name === 'string' && c.name.trim() !== '',
  mission: typeof c.mission === 'string' && c.mission.trim() !== '',
  summary: typeof c.summary === 'string' && c.summary.trim() !== '',
  skills_count: Array.isArray(c.skills) ? c.skills.length : 0,
  tags_count: Array.isArray(c.tags) ? c.tags.length : 0,
  services_count: Array.isArray(c.services) ? c.services.length : 0,
  examples_count: Array.isArray(c.examples) ? c.examples.length : 0
};

emit({
  ok: true,
  base_url,
  local_agent_id,
  stable_identity: stable.ok === true,
  legacy_agent_id,
  old_card_present,
  refreshed,
  fields_populated
});
