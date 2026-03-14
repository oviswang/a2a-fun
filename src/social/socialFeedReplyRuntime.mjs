import { parseSocialFeedReply } from './socialFeedReplyParser.mjs';
import {
  applyLocalReplyAction,
  applyRemoteJoinSignal,
  shouldEstablishFriendship
} from './socialHandoffState.mjs';
import { createTrustEdge } from './socialTrustEdge.mjs';

function nowIso() {
  return new Date().toISOString();
}

/**
 * Minimal runtime wiring helper (adapter-level):
 * - parse local user reply
 * - update handoff_state
 * - if friendship established, emit a trust edge record
 *
 * Note: remote human join signal is not yet transported over the network in v0.1.
 * Callers can separately applyRemoteJoinSignal({handoff_state}) when that signal exists.
 */
export function applySocialFeedReply({ text, handoff_state, local_agent_id, remote_agent_id } = {}) {
  const parsed = parseSocialFeedReply({ text });
  if (!parsed.ok) return parsed;

  const next = applyLocalReplyAction({ handoff_state, action: parsed.action });
  if (!next.ok) return next;

  const fr = shouldEstablishFriendship({ handoff_state: next.handoff_state });
  if (!fr.ok) return fr;

  if (fr.friendship_established !== true) {
    return { ok: true, action: parsed.action, handoff_state: next.handoff_state, friendship_established: false, trust_edge: null };
  }

  const edge = createTrustEdge({ local_agent_id, remote_agent_id, established_at: nowIso() });
  if (!edge.ok) {
    return { ok: true, action: parsed.action, handoff_state: next.handoff_state, friendship_established: true, trust_edge: null };
  }

  return { ok: true, action: parsed.action, handoff_state: next.handoff_state, friendship_established: true, trust_edge: edge };
}

// Adapter-level wiring helper for Remote Human Join Signal v0.1.
// If action is 'join', callers may provide {transport, peer, signal} to send the remote join.
export async function applySocialFeedReplyAndSendRemoteJoin({ text, handoff_state, local_agent_id, remote_agent_id, transport, peer, signal, sendJoin } = {}) {
  const out = applySocialFeedReply({ text, handoff_state, local_agent_id, remote_agent_id });
  if (!out.ok) return out;

  if (out.action === 'join') {
    try {
      if (typeof sendJoin === 'function') {
        await sendJoin({ transport, peer, signal });
      }
    } catch {
      // best-effort only
    }
  }

  return out;
}

export const _internal = { applyRemoteJoinSignal };
