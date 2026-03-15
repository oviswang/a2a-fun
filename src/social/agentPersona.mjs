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

function pickField(texts, key) {
  const rx = new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, 'im');
  for (const t of texts) {
    const m = String(t || '').match(rx);
    if (m && m[1] && String(m[1]).trim()) return String(m[1]).trim();
  }
  return '';
}

function pickBacktickedWords(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/`([a-zA-Z0-9_\-]{2,32})`/g)) out.add(m[1]);
  return [...out].sort((a, b) => a.localeCompare(b));
}

function boundedList(xs, max) {
  if (!Array.isArray(xs)) return [];
  return xs.map((s) => String(s).trim()).filter(Boolean).slice(0, max);
}

function fail(code) {
  return { ok: false, persona: null, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

/**
 * extractAgentPersona({ workspace_path, agent_id })
 *
 * Best-effort deterministic persona extraction.
 */
export async function extractAgentPersona({ workspace_path, agent_id } = {}) {
  if (typeof workspace_path !== 'string' || !workspace_path.trim()) return fail('INVALID_WORKSPACE_PATH');
  if (typeof agent_id !== 'string' || !agent_id.trim()) return fail('INVALID_AGENT_ID');

  const base = workspace_path.trim();
  const agentDir = path.join(base, 'agent');

  const soul = await readIfExists(path.join(agentDir, 'soul.md'));
  const profile = await readIfExists(path.join(agentDir, 'profile.md'));
  const current = await readIfExists(path.join(agentDir, 'current.md'));

  const texts = [soul, profile, current];

  const name = pickField(texts, 'name');
  const mission = pickField(texts, 'mission');
  const style = pickField(texts, 'style');
  const current_focus = pickField(texts, 'current_focus') || pickField(texts, 'focus');

  const interests = boundedList(pickBacktickedWords(`${profile || ''}\n${current || ''}`), 8);

  return {
    ok: true,
    persona: {
      agent_id: agent_id.trim(),
      name,
      mission,
      style,
      interests,
      current_focus
    },
    error: null
  };
}
