function normKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function isTooShort(s) {
  return String(s || '').trim().length < 20;
}

function hasQuestionArtifact(s) {
  const t = String(s || '').toLowerCase();
  return t.includes('question:') || t.includes('intent:') || t.includes('conversation goal:') || t.includes('expected output:');
}

function isNA(s) {
  const t = String(s || '').toLowerCase();
  return t.includes('n/a') || t.includes('none') || t.includes('not available');
}

function cleanList(list) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    if (typeof item !== 'string') continue;
    const raw = item.trim();
    if (!raw) continue;
    if (isTooShort(raw)) continue;
    if (hasQuestionArtifact(raw)) continue;
    if (isNA(raw)) continue;

    const k = normKey(raw);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(raw);
  }
  return out;
}

function removeCrossFieldDuplicates({ tools_workflow, what_worked, what_failed, next_step }) {
  // Priority: tools_workflow > what_worked > what_failed > next_step
  const keep = {
    tools_workflow: [],
    what_worked: [],
    what_failed: [],
    next_step: []
  };
  const seen = new Set();

  const take = (field, items) => {
    for (const s of items) {
      const k = normKey(s);
      if (seen.has(k)) continue;
      seen.add(k);
      keep[field].push(s);
    }
  };

  take('tools_workflow', tools_workflow);
  take('what_worked', what_worked);
  take('what_failed', what_failed);
  take('next_step', next_step);

  return keep;
}

function limit(list, n) {
  return list.slice(0, n);
}

export function cleanExperienceSummary(summary) {
  const s = summary && typeof summary === 'object' ? summary : {};

  const cleaned = {
    what_worked: cleanList(s.what_worked),
    what_failed: cleanList(s.what_failed),
    tools_workflow: cleanList(s.tools_workflow),
    next_step: cleanList(s.next_step)
  };

  const cross = removeCrossFieldDuplicates(cleaned);

  return {
    what_worked: limit(cross.what_worked, 5),
    what_failed: limit(cross.what_failed, 5),
    tools_workflow: limit(cross.tools_workflow, 5),
    next_step: limit(cross.next_step, 3)
  };
}
