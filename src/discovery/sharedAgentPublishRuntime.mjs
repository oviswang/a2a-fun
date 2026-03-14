import { extractAgentDiscoveryDocuments } from './agentDocumentExtractor.mjs';
import { buildAgentCardFromDocuments } from './agentCardBuilder.mjs';
import { publishAgentCardRemote } from './sharedAgentDirectoryClient.mjs';

function nonEmptyString(x) {
  return typeof x === 'string' && x.trim() !== '';
}

function fail(code) {
  return { ok: false, published: false, agent_id: null, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export async function publishLocalAgentCardToSharedDirectory({ workspace_path, agent_id, base_url } = {}) {
  if (!nonEmptyString(workspace_path)) return fail('INVALID_WORKSPACE_PATH');
  if (!nonEmptyString(agent_id)) return fail('INVALID_AGENT_ID');
  if (!nonEmptyString(base_url)) return fail('INVALID_BASE_URL');

  const docsOut = await extractAgentDiscoveryDocuments({ workspace_path });
  if (!docsOut.ok) return { ok: false, published: false, agent_id: agent_id.trim(), error: docsOut.error };

  const cardOut = buildAgentCardFromDocuments({ documents: docsOut.documents, agent_id });
  if (!cardOut.ok) return { ok: false, published: false, agent_id: agent_id.trim(), error: cardOut.error };

  return publishAgentCardRemote({ base_url, agent_id: agent_id.trim(), card: cardOut.agent_card });
}
