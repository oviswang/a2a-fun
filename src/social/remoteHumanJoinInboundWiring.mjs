import { handleRemoteHumanJoinSignal } from './remoteHumanJoinReceive.mjs';
import { createTrustEdge } from './socialTrustEdge.mjs';
import { bestEffortEmitSocialFeed } from './socialFeedRuntimeHook.mjs';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

export function handleInboundRemoteHumanJoin({ payload, handoff_state, local_agent_id = null, remote_agent_id = null } = {}) {
  const out = handleRemoteHumanJoinSignal({ payload, handoff_state });
  if (!out.ok) return out;

  let trust_edge = null;
  if (out.friendship_established === true && typeof local_agent_id === 'string' && typeof remote_agent_id === 'string') {
    const edge = createTrustEdge({
      local_agent_id,
      remote_agent_id,
      established_at: new Date().toISOString()
    });
    if (edge.ok) trust_edge = edge;
  }

  // Optional best-effort notification via social feed.
  // Reuse existing event types (minimal): conversation_summary.
  try {
    const sig = isObj(payload) ? payload.signal : null;
    const peer = (sig && typeof sig.from_agent_id === 'string' && sig.from_agent_id) || null;
    const summary = out.friendship_established === true ? 'Remote human joined; friendship established.' : 'Remote human joined.';
    bestEffortEmitSocialFeed({
      event_type: 'conversation_summary',
      peer_agent_id: peer,
      summary,
      details: { kind: 'REMOTE_HUMAN_JOIN_SIGNAL', friendship_established: out.friendship_established === true }
    }).catch(() => {});
  } catch {
    // best-effort only
  }

  return {
    ok: true,
    handoff_state: out.handoff_state,
    friendship_established: out.friendship_established,
    trust_edge,
    error: null
  };
}
