import { extractAgentDiscoveryDocuments } from './agentDocumentExtractor.mjs';
import { buildAgentCardFromDocuments } from './agentCardBuilder.mjs';

function fail(code) {
  return { ok: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export async function publishLocalAgentCard({ workspace_path, agent_id, publish } = {}) {
  if (typeof publish !== 'function') return fail('MISSING_PUBLISH');

  const docsOut = await extractAgentDiscoveryDocuments({ workspace_path });
  if (!docsOut.ok) return docsOut;

  const cardOut = buildAgentCardFromDocuments({ documents: docsOut.documents, agent_id });
  if (!cardOut.ok) return cardOut;

  return publish({ agent_id, card: cardOut.agent_card });
}
