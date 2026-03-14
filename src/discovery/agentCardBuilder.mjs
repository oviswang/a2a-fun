import { createAgentCard } from './agentCard.mjs';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function fail(code) {
  return { ok: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export function buildAgentCardFromDocuments({ documents, agent_id } = {}) {
  if (typeof agent_id !== 'string' || !agent_id.trim()) return fail('INVALID_AGENT_ID');
  if (!isObj(documents)) return fail('INVALID_DOCUMENTS');

  const out = createAgentCard({
    agent_id,
    soul: documents.soul || '',
    skills: Array.isArray(documents.skills) ? documents.skills : [],
    about: documents.about || '',
    services: Array.isArray(documents.services) ? documents.services : [],
    examples: Array.isArray(documents.examples) ? documents.examples : []
  });
  if (!out.ok) return out;

  // tags: derived from documents.tags
  const tags = Array.isArray(documents.tags) ? documents.tags.filter((s) => typeof s === 'string').map((s) => s.trim()).filter(Boolean) : [];
  const uniqTags = [...new Set(tags)].sort((a, b) => a.localeCompare(b));

  return {
    ok: true,
    agent_card: {
      ...out.agent_card,
      tags: uniqTags
    }
  };
}
