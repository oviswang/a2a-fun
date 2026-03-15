import { extractAgentDiscoveryDocuments } from '../discovery/agentDocumentExtractor.mjs';
import { buildAgentCardFromDocuments } from '../discovery/agentCardBuilder.mjs';
import { publishLocalAgentCardToSharedDirectory } from '../discovery/sharedAgentPublishRuntime.mjs';
import { listPublishedAgentsRemote } from '../discovery/sharedAgentDirectoryClient.mjs';

import { scoutAgentsFromSharedDirectory } from './agentScout.mjs';
import { rankAgentsByRelevance } from './agentMatcher.mjs';
import { createAgentSocialState, shouldContactCandidate, markContacted } from './agentSocialState.mjs';

import { bestEffortEmitSocialFeed } from './socialFeedRuntimeHook.mjs';
import { resolveStableAgentIdentity } from '../identity/stableIdentityRuntime.mjs';

function fail(code) {
  return {
    ok: false,
    local_agent_id: null,
    published: false,
    visible_agents: [],
    candidates_found: [],
    social_events_emitted: [],
    first_contact_sent: false,
    error: { code: String(code || 'FAILED').slice(0, 64) }
  };
}

export async function runAgentSocialEngineLiveRun({
  base_url,
  workspace_path,
  agent_id,
  sharedClient,
  send,
  context
} = {}) {
  if (typeof base_url !== 'string' || !base_url.trim()) return fail('INVALID_BASE_URL');
  if (typeof workspace_path !== 'string' || !workspace_path.trim()) return fail('INVALID_WORKSPACE_PATH');
  if (typeof agent_id !== 'string' || !agent_id.trim()) return fail('INVALID_AGENT_ID');
  if (!sharedClient || typeof sharedClient.listPublishedAgentsRemote !== 'function') return fail('INVALID_SHARED_CLIENT');

  // Provide a default send/context for observable local validation.
  if (typeof send === 'function') globalThis.__A2A_SOCIAL_SEND = send;
  if (context) globalThis.__A2A_SOCIAL_CONTEXT = context;
  // Resolve stable identity (best-effort). Transport/runtime ids remain separate.
  const transport_node_id = agent_id.trim();
  let local_agent_id = transport_node_id;
  try {
    const stable = resolveStableAgentIdentity({ context, agent_slug: 'default' });
    if (stable.ok && typeof stable.stable_agent_id === 'string' && stable.stable_agent_id) {
      local_agent_id = stable.stable_agent_id;
      globalThis.__A2A_PRINCIPAL_SOURCE = stable.principal_source;
    }
  } catch {
    // ignore
  }

  globalThis.__A2A_TRANSPORT_NODE_ID = transport_node_id;
  globalThis.__A2A_AGENT_ID = local_agent_id;

  
  const social_state = createAgentSocialState();

  // 1) publish self (best-effort; return machine-safe status)
  const pub = await publishLocalAgentCardToSharedDirectory({ workspace_path, agent_id: local_agent_id, base_url });

  // 2) list visible agents
  const list = await listPublishedAgentsRemote({ base_url });
  const visible_agents = list.ok ? (list.agents || []).map((a) => a?.agent_id).filter((x) => typeof x === 'string') : [];

  // 3) build local AgentCard
  const docsOut = await extractAgentDiscoveryDocuments({ workspace_path });
  if (!docsOut.ok) {
    return { ...fail(docsOut.error?.code || 'DOC_EXTRACT_FAILED'), local_agent_id, published: pub.ok === true };
  }
  const localCardOut = buildAgentCardFromDocuments({ documents: docsOut.documents, agent_id: local_agent_id });
  if (!localCardOut.ok) {
    return { ...fail(localCardOut.error?.code || 'CARD_BUILD_FAILED'), local_agent_id, published: pub.ok === true };
  }

  // 4) one immediate scout/match cycle
  const scout = await scoutAgentsFromSharedDirectory({ sharedClient, base_url, local_agent_card: localCardOut.agent_card });
  if (!scout.ok) {
    return {
      ok: true,
      local_agent_id,
      published: pub.ok === true,
      visible_agents,
      candidates_found: [],
      social_events_emitted: [],
      first_contact_sent: false,
      error: null
    };
  }

  const byId = new Map((list.ok ? list.agents : []).map((c) => [c.agent_id, c]));
  const candidateCards = scout.candidates.map((id) => byId.get(id)).filter(Boolean);

  const ranked = rankAgentsByRelevance({ local_card: localCardOut.agent_card, candidate_cards: candidateCards });
  if (!ranked.ok || ranked.ranked.length === 0) {
    return {
      ok: true,
      local_agent_id,
      published: pub.ok === true,
      visible_agents,
      candidates_found: scout.candidates,
      social_events_emitted: [],
      first_contact_sent: false,
      error: null
    };
  }

  const top = ranked.ranked[0];
  const gate = shouldContactCandidate({ state: social_state, agent_id: top.agent_id });
  if (!gate.ok || gate.should_contact !== true) {
    return {
      ok: true,
      local_agent_id,
      published: pub.ok === true,
      visible_agents,
      candidates_found: scout.candidates,
      social_events_emitted: [],
      first_contact_sent: false,
      error: null
    };
  }

  // 5) emit one candidate_found event (best-effort)
  await bestEffortEmitSocialFeed({
    event_type: 'candidate_found',
    peer_agent_id: top.agent_id,
    summary: 'Your agent found another agent that may share your interests.',
    details: { agent_id: top.agent_id, shared_tags: top.shared_tags, shared_skills: top.shared_skills }
  });

  markContacted({ state: social_state, agent_id: top.agent_id });

  return {
    ok: true,
    local_agent_id,
    published: pub.ok === true,
    visible_agents,
    candidates_found: scout.candidates,
    social_events_emitted: ['candidate_found'],
    first_contact_sent: false,
    error: null
  };
}
