import fs from 'node:fs/promises';
import path from 'node:path';

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

function listItems(md) {
  if (typeof md !== 'string') return [];
  const out = [];
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+(.+)\s*$/);
    if (!m) continue;
    const v = m[1].trim();
    if (v) out.push(v);
  }
  return out.slice(0, 50);
}

function extractWords(md) {
  if (typeof md !== 'string') return [];
  const words = new Set();
  for (const m of md.matchAll(/`([a-zA-Z0-9_\-]{2,32})`/g)) {
    words.add(m[1]);
  }
  return [...words].sort((a, b) => a.localeCompare(b));
}

export async function extractAgentDiscoveryDocuments({ workspace_path } = {}) {
  if (typeof workspace_path !== 'string' || !workspace_path.trim()) {
    return { ok: false, error: { code: 'INVALID_WORKSPACE_PATH' } };
  }

  const base = workspace_path.trim();
  const agentDir = path.join(base, 'agent');

  const soul = await readIfExists(path.join(agentDir, 'soul.md'));
  const skill = await readIfExists(path.join(agentDir, 'skill.md'));
  const about = await readIfExists(path.join(agentDir, 'about.md'));
  const servicesMd = await readIfExists(path.join(agentDir, 'services.md'));
  const examplesMd = await readIfExists(path.join(agentDir, 'examples.md'));

  return {
    ok: true,
    documents: {
      soul,
      skill,
      about,
      services_md: servicesMd,
      examples_md: examplesMd,
      // Derived structured hints (deterministic).
      skills: extractWords(skill),
      tags: extractWords(`${soul || ''}\n${about || ''}`),
      services: listItems(servicesMd),
      examples: listItems(examplesMd)
    }
  };
}
