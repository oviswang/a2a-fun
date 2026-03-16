function normKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function toSet(list) {
  const set = new Set();
  for (const s of Array.isArray(list) ? list : []) {
    if (typeof s !== 'string') continue;
    const k = normKey(s);
    if (k) set.add(k);
  }
  return set;
}

export function validateExperienceDecisions({ decisions, new_summary } = {}) {
  const decs = Array.isArray(decisions) ? decisions.filter((x) => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : [];
  const ns = new_summary && typeof new_summary === 'object' ? new_summary : {};

  const worked = toSet(ns.what_worked);
  const failed = toSet(ns.what_failed);

  const reinforced = [];
  const contradicted = [];
  const neutral = [];

  for (const d of decs) {
    const k = normKey(d);
    if (!k) continue;
    if (worked.has(k)) reinforced.push(k);
    else if (failed.has(k)) contradicted.push(k);
    else neutral.push(k);
  }

  return { reinforced, contradicted, neutral };
}
