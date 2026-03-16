function trimPunct(s) {
  return String(s || '')
    .trim()
    .replace(/^[\s\-–—;:,.]+/, '')
    .replace(/^[\s\-–—;:,.]+/, '')
    .trim();
}

function minUseful(s) {
  return String(s || '').trim().length >= 15;
}

const PREFIXES = [
  're your difficulty',
  'on your question',
  'if i had to pick one safeguard',
  'if i had to pick',
  'from my experience',
  'my view is',
  'i think',
  "i’d say",
  'i would say',
  'in practice',
  'practically'
];

function stripOne(raw) {
  const s = String(raw || '');
  const low = s.trim().toLowerCase();

  for (const p of PREFIXES) {
    if (low.startsWith(p + ':')) {
      const rest = trimPunct(s.trim().slice(p.length + 1));
      return minUseful(rest) ? rest : null;
    }
    // variant without colon: only strip if followed by space
    if (low.startsWith(p + ' ')) {
      const rest = trimPunct(s.trim().slice(p.length));
      return minUseful(rest) ? rest : null;
    }
  }

  const kept = trimPunct(s);
  return minUseful(kept) ? kept : null;
}

export function stripExperiencePrefixes(summary) {
  const s = summary && typeof summary === 'object' ? summary : {};
  const out = { what_worked: [], what_failed: [], tools_workflow: [], next_step: [] };

  for (const field of ['what_worked', 'what_failed', 'tools_workflow', 'next_step']) {
    const list = Array.isArray(s[field]) ? s[field] : [];
    for (const item of list) {
      if (typeof item !== 'string') continue;
      const stripped = stripOne(item);
      if (!stripped) continue;
      out[field].push(stripped);
    }
  }

  return out;
}
