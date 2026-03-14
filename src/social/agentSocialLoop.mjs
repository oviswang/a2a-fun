import { scoutAgentsFromSharedDirectory } from './agentScout.mjs';
import { rankAgentsByRelevance } from './agentMatcher.mjs';
import { shouldContactCandidate, markContacted } from './agentSocialState.mjs';
import { bestEffortEmitSocialFeed } from './socialFeedRuntimeHook.mjs';
import { sendAgentFirstContact } from './agentFirstContact.mjs';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

export function startAgentSocialLoop({
  enabled = false,
  intervalMs = 10 * 60 * 1000,
  base_url,
  sharedClient,
  local_agent_card,
  social_state,
  getCandidateCards,
  transport,
  peerForAgent
} = {}) {
  if (!enabled) {
    return { ok: true, started: false, stop: async () => {} };
  }

  if (!isObj(sharedClient) || typeof sharedClient.listPublishedAgentsRemote !== 'function') {
    return { ok: false, error: { code: 'INVALID_SHARED_CLIENT' } };
  }
  if (!isObj(local_agent_card) || typeof local_agent_card.agent_id !== 'string') {
    return { ok: false, error: { code: 'INVALID_LOCAL_AGENT_CARD' } };
  }
  if (!isObj(social_state)) {
    return { ok: false, error: { code: 'INVALID_SOCIAL_STATE' } };
  }
  if (typeof getCandidateCards !== 'function') {
    return { ok: false, error: { code: 'MISSING_GET_CANDIDATE_CARDS' } };
  }

  let stopped = false;
  let timer = null;

  async function tick() {
    if (stopped) return;

    try {
      const scout = await scoutAgentsFromSharedDirectory({ sharedClient, base_url, local_agent_card });
      if (!scout.ok) return;

      const candidateCards = await Promise.resolve(getCandidateCards({ agent_ids: scout.candidates })).catch(() => []);
      const ranked = rankAgentsByRelevance({ local_card: local_agent_card, candidate_cards: candidateCards });
      if (!ranked.ok) return;

      const top = ranked.ranked[0] || null;
      if (!top) return;

      const gate = shouldContactCandidate({ state: social_state, agent_id: top.agent_id });
      if (!gate.ok || gate.should_contact !== true) return;

      // Emit social feed (best-effort).
      bestEffortEmitSocialFeed({
        event_type: 'candidate_found',
        peer_agent_id: top.agent_id,
        summary: 'Your agent found another agent that may share your interests.',
        details: { agent_id: top.agent_id, shared_tags: top.shared_tags, shared_skills: top.shared_skills }
      }).catch(() => {});

      // Optional first contact if transport is available.
      if (typeof transport === 'function' && typeof peerForAgent === 'function') {
        const peer = await Promise.resolve(peerForAgent({ agent_id: top.agent_id })).catch(() => null);
        if (peer) {
          await sendAgentFirstContact({
            transport,
            peer,
            from_agent_id: local_agent_card.agent_id,
            to_agent_id: top.agent_id,
            shared_tags: top.shared_tags,
            shared_skills: top.shared_skills
          }).catch(() => {});
        }
      }

      markContacted({ state: social_state, agent_id: top.agent_id });
    } finally {
      if (!stopped) timer = setTimeout(tick, Math.max(60_000, Number(intervalMs) || 0));
    }
  }

  timer = setTimeout(tick, 0);

  return {
    ok: true,
    started: true,
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
}

// Minimal runtime hook (optional): set social context and start the loop.
// Not enabled by default; callers must pass enabled:true.
export function startAgentSocialLoopWithContext({ context, ...opts } = {}) {
  try {
    globalThis.__A2A_SOCIAL_CONTEXT = context || null;
  } catch {
    // ignore
  }
  return startAgentSocialLoop(opts);
}
