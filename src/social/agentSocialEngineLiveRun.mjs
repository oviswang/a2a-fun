import { extractAgentDiscoveryDocuments } from '../discovery/agentDocumentExtractor.mjs';
import { buildAgentCardFromDocuments } from '../discovery/agentCardBuilder.mjs';
import { publishLocalAgentCardToSharedDirectory } from '../discovery/sharedAgentPublishRuntime.mjs';
import { listPublishedAgentsRemote } from '../discovery/sharedAgentDirectoryClient.mjs';

import { scoutAgentsFromSharedDirectory } from './agentScout.mjs';
import { rankAgentsByRelevance } from './agentMatcher.mjs';
import { createAgentSocialState, shouldContactCandidate, markContacted } from './agentSocialState.mjs';

import { bestEffortEmitSocialFeed } from './socialFeedRuntimeHook.mjs';
import { resolveStableAgentIdentity } from '../identity/stableIdentityRuntime.mjs';
import { upsertDiscoveredAgent, loadLocalAgentMemory, saveLocalAgentMemory, upsertLocalAgentMemoryRecord, getDefaultLocalAgentMemoryPath } from '../memory/localAgentMemory.mjs';
import { sendAgentHandshake } from './agentHandshakeSender.mjs';
import { buildAgentCurrentProfile } from './agentCurrentProfile.mjs';
import { sendAgentProfileExchange } from './agentProfileExchangeSender.mjs';
import { buildAttentionSnapshot } from '../attention/buildAttentionSnapshot.mjs';
import { selectRelevantPeer } from '../attention/selectRelevantPeer.mjs';
import { explainAttentionDecision } from '../attention/explainAttentionDecision.mjs';

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

  // 5) local memory update (best-effort)
  try {
    const card = byId.get(top.agent_id);
    await upsertDiscoveredAgent({
      workspace_path,
      peer_agent_id: top.agent_id,
      display_name: typeof card?.name === 'string' ? card.name : '',
      summary: typeof card?.summary === 'string' ? card.summary : '',
      source: { type: 'directory', base_url }
    });
  } catch {
    // best-effort only
  }

  // 5b) attention-based selection helper (v0.1, additive; does not change current candidate_found behavior)
  try {
    const snapOut = await buildAttentionSnapshot({ workspace_path, agent_id: localCardOut.agent_card.agent_id });
    if (snapOut.ok) {
      const file_path = getDefaultLocalAgentMemoryPath({ workspace_path });
      const loaded = await loadLocalAgentMemory({ file_path });
      const sel = selectRelevantPeer({ snapshot: snapOut.snapshot, local_memory: loaded.ok ? loaded : { records: [] }, candidates: candidateCards });
      if (sel.ok) {
        console.log(JSON.stringify({ ok: true, event: 'ATTENTION_PEER_SELECTED', selected_peer_agent_id: sel.selected_peer_agent_id, reason: sel.reason, score: sel.score }));
        const exp = explainAttentionDecision({ snapshot: snapOut.snapshot, peerSelection: sel });
        if (exp.ok) console.log(JSON.stringify({ ok: true, event: 'ATTENTION_DECISION_EXPLAINED', text: exp.text }));
      }
    }
  } catch {
    // best-effort only
  }

  // 6) automatic handshake (best-effort)
  try {
    const file_path = getDefaultLocalAgentMemoryPath({ workspace_path });
    const loaded = await loadLocalAgentMemory({ file_path });
    if (loaded.ok) {
      const rec = loaded.records.find((r) => (r?.stable_agent_id && r.stable_agent_id === top.agent_id) || (r?.legacy_agent_id && r.legacy_agent_id === top.agent_id)) || null;
      const state = rec?.relationship_state;
      const last_handshake_at = rec?.last_handshake_at || null;
      if (state === 'discovered' && !last_handshake_at) {
        const relayUrl = process.env.RELAY_URL || 'wss://bootstrap.a2a.fun/relay';
        const hs = await sendAgentHandshake({
          local_agent: localCardOut.agent_card,
          remote_agent: { agent_id: top.agent_id },
          relayUrl
        });
        if (hs.ok && hs.handshake) {
          const up = upsertLocalAgentMemoryRecord({
            records: loaded.records,
            patch: {
              stable_agent_id: top.agent_id.startsWith('aid:sha256:') ? top.agent_id : null,
              legacy_agent_id: top.agent_id.startsWith('aid:sha256:') ? null : top.agent_id,
              relationship_state: 'introduced',
              last_handshake_at: hs.handshake.timestamp
            }
          });
          if (up.ok) await saveLocalAgentMemory({ file_path, records: up.records });
        }
      }

      // 6b) introduced -> engaged trigger (best-effort; send once per peer)
      try {
        const loaded2 = await loadLocalAgentMemory({ file_path });
        if (loaded2.ok) {
          const rec2 = loaded2.records.find((r) => (r?.stable_agent_id && r.stable_agent_id === top.agent_id) || (r?.legacy_agent_id && r.legacy_agent_id === top.agent_id)) || null;
          const state2 = rec2?.relationship_state;
          const last_dialogue_at = rec2?.last_dialogue_at || null;
          if (state2 === 'introduced' && !last_dialogue_at) {
            const relayUrl = process.env.RELAY_URL || 'wss://bootstrap.a2a.fun/relay';
            const profOut = await buildAgentCurrentProfile({ workspace_path, agent_id: localCardOut.agent_card.agent_id, local_base_url: 'http://127.0.0.1:3000' });
            if (profOut.ok) {
              await sendAgentProfileExchange({
                local_profile: profOut.profile,
                remote_agent_id: top.agent_id,
                relayUrl,
                prompt: 'current focus, strengths, and one next step'
              });
            }
          }
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // best-effort only
  }

  // 7) emit one candidate_found event (best-effort)
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
