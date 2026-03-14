import { validateNetworkAgentDirectoryEntry } from './networkAgentDirectoryEntry.mjs';
import { searchAgents } from './agentSearch.mjs';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function nonEmptyString(x) {
  return typeof x === 'string' && x.trim() !== '';
}

function fail(code) {
  return { ok: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export function createNetworkAgentDirectory() {
  return { kind: 'NETWORK_AGENT_DIRECTORY_V0_1', byAgentId: new Map() };
}

export function publishAgentCard({ directory, entry } = {}) {
  if (!isObj(directory) || directory.kind !== 'NETWORK_AGENT_DIRECTORY_V0_1' || !(directory.byAgentId instanceof Map)) {
    return fail('INVALID_DIRECTORY');
  }
  const v = validateNetworkAgentDirectoryEntry(entry);
  if (!v.ok) return v;

  // Replace deterministically by agent_id.
  directory.byAgentId.set(entry.agent_id, entry);
  return { ok: true, published: true };
}

export function listPublishedAgents({ directory } = {}) {
  if (!isObj(directory) || directory.kind !== 'NETWORK_AGENT_DIRECTORY_V0_1' || !(directory.byAgentId instanceof Map)) {
    return fail('INVALID_DIRECTORY');
  }

  const entries = [...directory.byAgentId.values()].sort((a, b) => String(a.agent_id).localeCompare(String(b.agent_id)));
  return { ok: true, agents: entries.map((e) => e.card) };
}

export function searchPublishedAgents({ directory, query, trust_edges = null, local_agent_id = null } = {}) {
  if (typeof query !== 'string') return fail('INVALID_QUERY');
  const listOut = listPublishedAgents({ directory });
  if (!listOut.ok) return listOut;

  // Reuse existing AgentCard keyword search + optional trust ordering.
  return searchAgents({ agent_cards: listOut.agents, query, trust_edges, local_agent_id });
}

export function _internalDumpEntries({ directory } = {}) {
  if (!isObj(directory) || directory.kind !== 'NETWORK_AGENT_DIRECTORY_V0_1' || !(directory.byAgentId instanceof Map)) {
    return [];
  }
  return [...directory.byAgentId.values()].sort((a, b) => String(a.agent_id).localeCompare(String(b.agent_id)));
}
