function normKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function uniq(list) {
  const out = [];
  const seen = new Set();
  for (const s of Array.isArray(list) ? list : []) {
    if (typeof s !== 'string') continue;
    const raw = s.trim();
    if (!raw) continue;
    const k = normKey(raw);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(raw);
  }
  return out;
}

function limit(list, n) {
  return list.slice(0, n);
}

function classifyOne(text) {
  const t = normKey(text);

  const hasAny = (phrases) => phrases.some((p) => t.includes(p));

  // Rule A — next_step / safeguard
  const isNext = hasAny([
    'next step',
    'should',
    'need to',
    'recommend',
    'suggest',
    'safeguard',
    'alert when',
    'monitor',
    'check that',
    'guardrail'
  ]);

  // Rule B — tools_workflow
  const isTools = hasAny([
    '/nodes',
    '/traces',
    'script',
    'workflow',
    'command',
    'tool',
    'process',
    'procedure',
    'check after each change',
    'loop of'
  ]);

  // Rule C — what_failed
  const isFailed = hasAny([
    'failed',
    'problem',
    'issue',
    'culprit',
    'churn',
    'dropped',
    'timeout',
    'unregister',
    'no target',
    'instability',
    'broken'
  ]);

  // Rule D — what_worked
  const isWorked = hasAny([
    'worked',
    'reliable',
    'successful',
    'effective',
    'keep exactly one',
    'long-running',
    'reuse it',
    'trust',
    'healthy'
  ]);

  // Rule E — tie-breaking priority
  if (isNext) return 'next_step';
  if (isTools) return 'tools_workflow';
  if (isFailed) return 'what_failed';
  if (isWorked) return 'what_worked';
  return null;
}

export function classifyExperienceSummary(summary) {
  const s = summary && typeof summary === 'object' ? summary : {};

  const all = [];
  for (const f of ['what_worked', 'what_failed', 'tools_workflow', 'next_step']) {
    for (const item of Array.isArray(s[f]) ? s[f] : []) all.push(item);
  }

  const buckets = { what_worked: [], what_failed: [], tools_workflow: [], next_step: [], _unclassified: [] };

  for (const raw of uniq(all)) {
    const dest = classifyOne(raw);
    if (!dest) buckets._unclassified.push(raw);
    else buckets[dest].push(raw);
  }

  // Deduplicate again after reclassification (within field)
  buckets.what_worked = uniq(buckets.what_worked);
  buckets.what_failed = uniq(buckets.what_failed);
  buckets.tools_workflow = uniq(buckets.tools_workflow);
  buckets.next_step = uniq(buckets.next_step);

  // Enforce same field size limits as cleanup
  return {
    what_worked: limit(buckets.what_worked, 5),
    what_failed: limit(buckets.what_failed, 5),
    tools_workflow: limit(buckets.tools_workflow, 5),
    next_step: limit(buckets.next_step, 3)
  };
}
