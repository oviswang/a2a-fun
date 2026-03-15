import fs from 'node:fs/promises';
import path from 'node:path';

import { extractAgentDiscoveryDocuments } from '../discovery/agentDocumentExtractor.mjs';
import { buildAgentCardFromDocuments } from '../discovery/agentCardBuilder.mjs';
import { introspectLocalCapabilities } from '../discovery/agentCapabilityIntrospector.mjs';

const MAX_BYTES = 64 * 1024;

async function readIfExists(p) {
  try {
    const buf = await fs.readFile(p);
    const s = buf.toString('utf8');
    return s.length > MAX_BYTES ? s.slice(0, MAX_BYTES) : s;
  } catch {
    return null;
  }
}

function pickField(text, key) {
  const rx = new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, 'im');
  const m = String(text || '').match(rx);
  return m && m[1] ? String(m[1]).trim() : '';
}

function stableUniqSorted(xs) {
  return [...new Set(xs)].sort((a, b) => a.localeCompare(b));
}

function fail(code) {
  return { ok: false, profile: null, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export async function buildAgentCurrentProfile({ workspace_path, agent_id, local_base_url = 'http://127.0.0.1:3000' } = {}) {
  if (typeof workspace_path !== 'string' || !workspace_path.trim()) return fail('INVALID_WORKSPACE_PATH');
  if (typeof agent_id !== 'string' || !agent_id.trim()) return fail('INVALID_AGENT_ID');

  const ws = workspace_path.trim();
  const agentDir = path.join(ws, 'agent');

  const currentMd = await readIfExists(path.join(agentDir, 'current.md'));
  const current_focus = pickField(currentMd, 'current_focus') || pickField(currentMd, 'focus');

  // Docs + card enrichment
  const docsOut = await extractAgentDiscoveryDocuments({ workspace_path: ws });
  if (!docsOut.ok) return fail(docsOut.error?.code || 'DOC_EXTRACT_FAILED');

  // Best-effort local capabilities
  let caps = [];
  try {
    const capOut = await introspectLocalCapabilities({ base_url: local_base_url });
    if (capOut.ok) caps = capOut.capabilities;
  } catch {
    caps = [];
  }

  const cardOut = buildAgentCardFromDocuments({ documents: docsOut.documents, agent_id: agent_id.trim(), capabilities: caps });
  if (!cardOut.ok) return fail(cardOut.error?.code || 'CARD_BUILD_FAILED');

  const card = cardOut.agent_card;

  return {
    ok: true,
    profile: {
      agent_id: card.agent_id,
      name: card.name,
      mission: card.mission,
      summary: card.summary,
      skills: stableUniqSorted(Array.isArray(card.skills) ? card.skills : []).slice(0, 50),
      current_focus: String(current_focus || '').trim().slice(0, 160)
    },
    error: null
  };
}
