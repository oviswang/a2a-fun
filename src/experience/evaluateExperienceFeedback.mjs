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
    if (!k) continue;
    set.add(k);
  }
  return set;
}

function overlap(aSet, bSet) {
  const out = [];
  for (const k of aSet) {
    if (bSet.has(k)) out.push(k);
  }
  return out;
}

export function evaluateExperienceFeedback({ topic, injected_knowledge, new_summary } = {}) {
  const tp = String(topic || '').trim();
  const inj = injected_knowledge && typeof injected_knowledge === 'object' ? injected_knowledge : {};
  const neu = new_summary && typeof new_summary === 'object' ? new_summary : {};

  const injWorked = toSet(inj.what_worked);
  const injFailed = toSet(inj.what_failed);

  const newWorked = toSet(neu.what_worked);
  const newFailed = toSet(neu.what_failed);

  const reinforced = [];
  const contradicted = [];
  const new_experience = [];

  // Reinforcement: overlaps
  for (const k of overlap(newWorked, injWorked)) reinforced.push(k);
  for (const k of overlap(newFailed, injFailed)) reinforced.push(k);

  // Contradictions: cross overlaps
  for (const k of overlap(newWorked, injFailed)) contradicted.push(k);
  for (const k of overlap(newFailed, injWorked)) contradicted.push(k);

  // New experience: anything in new summary not in injected (worked/failed)
  const injectedUnion = new Set([...injWorked, ...injFailed]);
  for (const k of new Set([...newWorked, ...newFailed])) {
    if (!injectedUnion.has(k)) new_experience.push(k);
  }

  return {
    topic: tp,
    reinforced,
    contradicted,
    new_experience
  };
}
