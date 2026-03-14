function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function nonEmptyString(x) {
  return typeof x === 'string' && x.trim() !== '';
}

function bounded(x, max) {
  if (typeof x !== 'string') return '';
  const s = x.trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function stringArray(x) {
  if (!Array.isArray(x)) return null;
  for (const v of x) if (typeof v !== 'string') return null;
  return x.map((s) => s.trim()).filter(Boolean);
}

function fail(code) {
  return { ok: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export function createAgentCard({
  agent_id,
  soul,
  skills,
  about,
  services,
  examples
} = {}) {
  if (!nonEmptyString(agent_id)) return fail('INVALID_AGENT_ID');

  const sk = stringArray(skills);
  const tg = null; // tags derived in builder; schema keeps tags array.
  const sv = stringArray(services);
  const ex = stringArray(examples);

  if (skills != null && sk === null) return fail('INVALID_SKILLS');
  if (services != null && sv === null) return fail('INVALID_SERVICES');
  if (examples != null && ex === null) return fail('INVALID_EXAMPLES');

  // Inputs may be missing; degrade gracefully.
  const soulText = typeof soul === 'string' ? soul : '';
  const aboutText = typeof about === 'string' ? about : '';

  const name = bounded(extractField(soulText, aboutText, 'name'), 80);
  const mission = bounded(extractField(soulText, aboutText, 'mission'), 160);
  const summary = bounded(extractSummary(soulText, aboutText), 280);

  return {
    ok: true,
    agent_card: {
      agent_id: agent_id.trim(),
      name,
      mission,
      summary,
      skills: (sk || []).sort((a, b) => a.localeCompare(b)),
      tags: (tg || []),
      services: (sv || []).sort((a, b) => a.localeCompare(b)),
      examples: (ex || []).slice(0, 10)
    }
  };
}

function extractField(soulText, aboutText, key) {
  // Very small heuristic: look for "Name:" / "Mission:" in either file.
  const rx = new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, 'im');
  const m1 = soulText.match(rx);
  if (m1) return m1[1];
  const m2 = aboutText.match(rx);
  if (m2) return m2[1];
  return '';
}

function extractSummary(soulText, aboutText) {
  // Take first non-empty line from about.md else soul.md.
  const pick = (txt) => {
    for (const line of String(txt || '').split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      if (s.startsWith('#')) continue;
      return s;
    }
    return '';
  };
  return pick(aboutText) || pick(soulText) || '';
}

export function isAgentCard(x) {
  if (!isObj(x)) return false;
  if (!nonEmptyString(x.agent_id)) return false;
  if (typeof x.name !== 'string') return false;
  if (typeof x.mission !== 'string') return false;
  if (typeof x.summary !== 'string') return false;
  if (!Array.isArray(x.skills) || x.skills.some((s) => typeof s !== 'string')) return false;
  if (!Array.isArray(x.tags) || x.tags.some((s) => typeof s !== 'string')) return false;
  if (!Array.isArray(x.services) || x.services.some((s) => typeof s !== 'string')) return false;
  if (!Array.isArray(x.examples) || x.examples.some((s) => typeof s !== 'string')) return false;
  return true;
}
