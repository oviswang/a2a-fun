import { markAgentInterested } from '../memory/markAgentInterested.mjs';

// In-memory pending prompt store (v0.1)
const pendingInterestPrompts = new Map(); // peer_agent_id -> { peer_agent_id, created_at, last_summary }

function nowIso() {
  return new Date().toISOString();
}

function safe(s) {
  return typeof s === 'string' ? s.trim() : '';
}

export function registerPendingInterestPrompt({ peer_agent_id, last_summary = '' } = {}) {
  const id = safe(peer_agent_id);
  if (!id) return { ok: false, error: { code: 'INVALID_PEER_AGENT_ID' } };

  pendingInterestPrompts.set(id, { peer_agent_id: id, created_at: nowIso(), last_summary: safe(last_summary) });
  return { ok: true };
}

export function hasPendingInterestPrompt({ peer_agent_id } = {}) {
  const id = safe(peer_agent_id);
  return id ? pendingInterestPrompts.has(id) : false;
}

export function clearPendingInterestPrompt({ peer_agent_id } = {}) {
  const id = safe(peer_agent_id);
  if (!id) return { ok: false, error: { code: 'INVALID_PEER_AGENT_ID' } };
  pendingInterestPrompts.delete(id);
  return { ok: true };
}

/**
 * handleInterestDecision({ workspace_path, peer_agent_id, text })
 *
 * text:
 * - "1" => interested
 * - "2" => skip
 */
export async function handleInterestDecision({ workspace_path, peer_agent_id, text } = {}) {
  const id = safe(peer_agent_id);
  if (!id) return { ok: false, error: { code: 'INVALID_PEER_AGENT_ID' } };

  if (!pendingInterestPrompts.has(id)) {
    return { ok: false, error: { code: 'NO_PENDING_PROMPT' } };
  }

  const s = safe(text);
  if (s === '1') {
    await markAgentInterested({ workspace_path, peer_agent_id: id });
    pendingInterestPrompts.delete(id);
    return { ok: true, decision: 'interested' };
  }

  if (s === '2') {
    console.log(JSON.stringify({ ok: true, event: 'AGENT_INTEREST_SKIPPED', peer_agent_id: id, timestamp: nowIso() }));
    pendingInterestPrompts.delete(id);
    return { ok: true, decision: 'skip' };
  }

  return { ok: false, error: { code: 'INVALID_DECISION' } };
}
