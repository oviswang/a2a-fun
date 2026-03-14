import { isAgentCard } from './agentCard.mjs';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function nonEmptyString(x) {
  return typeof x === 'string' && x.trim() !== '';
}

function fail(code) {
  return { ok: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export function createNetworkAgentDirectoryEntry({ agent_id, published_at, card } = {}) {
  if (!nonEmptyString(agent_id)) return fail('INVALID_AGENT_ID');
  if (!nonEmptyString(published_at)) return fail('INVALID_PUBLISHED_AT');
  if (!isAgentCard(card)) return fail('INVALID_AGENT_CARD');

  return {
    ok: true,
    entry: {
      agent_id: agent_id.trim(),
      published_at: published_at.trim(),
      card
    }
  };
}

export function validateNetworkAgentDirectoryEntry(entry) {
  if (!isObj(entry)) return fail('INVALID_ENTRY');
  if (!nonEmptyString(entry.agent_id)) return fail('INVALID_AGENT_ID');
  if (!nonEmptyString(entry.published_at)) return fail('INVALID_PUBLISHED_AT');
  if (!isAgentCard(entry.card)) return fail('INVALID_AGENT_CARD');
  return { ok: true };
}
