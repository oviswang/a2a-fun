import { createAgentCard } from './agentCard.mjs';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function fail(code) {
  return { ok: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

function normList(x, { max = 64 } = {}) {
  if (!Array.isArray(x)) return [];
  const out = [];
  for (const v of x) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (!s) continue;
    if (s.length > max) continue;
    out.push(s);
  }
  return out;
}

function stableUniqSorted(xs) {
  return [...new Set(xs)].sort((a, b) => a.localeCompare(b));
}

function inferTagsFromSkills(skills) {
  const s = new Set(skills.map((x) => x.toLowerCase()));
  const tags = [];

  // Very small deterministic mapping (v0.1).
  if (s.has('translate') || s.has('translation')) tags.push('translation');
  if (s.has('echo')) tags.push('utility');
  if (s.has('text_transform') || s.has('text-transform')) tags.push('text');

  return tags;
}

function buildDeterministicSummary({ name, mission, skills }) {
  const n = typeof name === 'string' ? name.trim() : '';
  const m = typeof mission === 'string' ? mission.trim() : '';
  const top = Array.isArray(skills) ? skills.slice(0, 3).map((x) => String(x).trim()).filter(Boolean) : [];

  const parts = [];
  if (n) parts.push(n);
  if (m) parts.push(m);
  if (top.length > 0) parts.push(`skills: ${top.join(', ')}`);

  return parts.join(' — ');
}

export function buildAgentCardFromDocuments({ documents, agent_id, capabilities = null, inferred_tags = null } = {}) {
  if (typeof agent_id !== 'string' || !agent_id.trim()) return fail('INVALID_AGENT_ID');
  if (!isObj(documents)) return fail('INVALID_DOCUMENTS');

  const docSkills = normList(documents.skills, { max: 64 });
  const capSkills = normList(capabilities, { max: 64 });
  const mergedSkills = stableUniqSorted([...docSkills, ...capSkills]);

  const out = createAgentCard({
    agent_id,
    soul: documents.soul || '',
    skills: mergedSkills,
    about: documents.about || '',
    services: Array.isArray(documents.services) ? documents.services : [],
    examples: Array.isArray(documents.examples) ? documents.examples : []
  });
  if (!out.ok) return out;

  // tags: explicit backticked tags + inferred tags
  const explicitTags = normList(documents.tags, { max: 32 }).map((t) => t.toLowerCase());
  const inferredFromSkills = inferTagsFromSkills(mergedSkills);
  const extraInferred = normList(inferred_tags, { max: 32 }).map((t) => t.toLowerCase());

  const uniqTags = stableUniqSorted([...explicitTags, ...inferredFromSkills, ...extraInferred]);

  // summary: deterministic composite (no LLM)
  const summary = buildDeterministicSummary({ name: out.agent_card.name, mission: out.agent_card.mission, skills: mergedSkills }) || out.agent_card.summary;

  return {
    ok: true,
    agent_card: {
      ...out.agent_card,
      summary,
      skills: mergedSkills,
      tags: uniqTags
    }
  };
}
