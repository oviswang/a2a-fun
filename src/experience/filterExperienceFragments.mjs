function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const LEAD_INS = [
  're your difficulty',
  'on your question',
  'if i had to pick',
  'workflow/tools used',
  'my real local focus',
  'one recent task',
  'practical question',
  'i heard you'
];

const TECH_KEEP = [
  '/nodes',
  '/traces',
  'node_id',
  'session',
  'relay',
  'client',
  'alert',
  'keep',
  'avoid',
  'reuse',
  'check',
  'monitor',
  'churn',
  'timeout',
  'unregister',
  'dropped',
  'no target'
];

function hasTechKeep(s) {
  const t = norm(s);
  return TECH_KEEP.some((k) => t.includes(k));
}

function isLeadIn(s) {
  const t = norm(s);
  return LEAD_INS.some((p) => t.startsWith(p));
}

function isGenericFramingStub(s) {
  const t = norm(s);
  // framing-only patterns we want to drop when they lack concrete technical content
  const stubs = [
    'on your question',
    'workflow/tools used',
    'if i had to pick one safeguard',
    'practical question'
  ];
  if (stubs.some((p) => t === p || t.startsWith(p))) return true;
  return false;
}

export function filterExperienceFragments(summary) {
  const s = summary && typeof summary === 'object' ? summary : {};
  const out = { what_worked: [], what_failed: [], tools_workflow: [], next_step: [] };

  for (const field of ['what_worked', 'what_failed', 'tools_workflow', 'next_step']) {
    const list = Array.isArray(s[field]) ? s[field] : [];
    for (const item of list) {
      if (typeof item !== 'string') continue;
      const raw = item.trim();
      if (!raw) continue;

      const keep = hasTechKeep(raw);

      // Rule C/D: preserve concrete operational statements
      if (keep) {
        out[field].push(raw);
        continue;
      }

      // Rule A: remove lead-ins
      if (isLeadIn(raw)) continue;

      // Rule B: remove generic framing without concrete content
      if (isGenericFramingStub(raw)) continue;

      // Default: keep (minimal)
      out[field].push(raw);
    }
  }

  return out;
}
