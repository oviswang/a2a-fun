function trimPunct(s) {
  return String(s || '')
    .trim()
    .replace(/^[\s\-–—;:,.]+/, '')
    .replace(/[\s\-–—;:,.]+$/, '')
    .trim();
}

function minUseful(s) {
  return String(s || '').trim().length >= 15;
}

function splitStrong(text) {
  // Strong separators: em dash, semicolon.
  // Colon: only split when both sides have meaningful length.
  let parts = [String(text || '')];

  const applySplit = (arr, splitter) =>
    arr.flatMap((p) =>
      String(p)
        .split(splitter)
        .map((x) => x)
    );

  // em dash (—)
  parts = applySplit(parts, '—');
  // semicolon
  parts = parts.flatMap((p) => p.split(';'));

  // colon (meaningful both sides)
  parts = parts.flatMap((p) => {
    const idx = p.indexOf(':');
    if (idx === -1) return [p];
    const a = p.slice(0, idx);
    const b = p.slice(idx + 1);
    if (trimPunct(a).length >= 20 && trimPunct(b).length >= 20) return [a, b];
    return [p];
  });

  return parts;
}

function maybeSplitButAnd(text) {
  // Split on " but " when both sides are meaningful.
  const t = String(text || '');
  const idx = t.toLowerCase().indexOf(' but ');
  if (idx === -1) return [t];
  const a = t.slice(0, idx);
  const b = t.slice(idx + 5);
  if (minUseful(trimPunct(a)) && minUseful(trimPunct(b))) return [a, b];
  return [t];
}

function maybeSplitAnd(text) {
  // Split on " and " only when it likely joins separate actions/outcomes.
  // Deterministic heuristic: if contains " and " AND also contains an action cue later.
  const t = String(text || '');
  const low = t.toLowerCase();
  const idx = low.indexOf(' and ');
  if (idx === -1) return [t];

  const a = t.slice(0, idx);
  const b = t.slice(idx + 5);

  const bLow = b.toLowerCase();
  const actionCue = ['avoid ', 'keep ', 'alert ', 'monitor', 'check ', 'reuse', 'stop ', 'start '].some((k) => bLow.includes(k));

  if (actionCue && minUseful(trimPunct(a)) && minUseful(trimPunct(b))) return [a, b];
  return [t];
}

function splitOne(text) {
  let parts = splitStrong(text);
  // preserve order, do weak splits after strong splits
  parts = parts.flatMap(maybeSplitButAnd);
  parts = parts.flatMap(maybeSplitAnd);

  // cleanup + drop short fragments
  const out = [];
  for (const p of parts) {
    const f = trimPunct(p);
    if (!minUseful(f)) continue;
    out.push(f);
  }

  // If splitting produced nothing useful, fall back to original (if useful)
  if (out.length === 0) {
    const f = trimPunct(text);
    return minUseful(f) ? [f] : [];
  }

  return out;
}

export function splitExperienceSummary(summary) {
  const s = summary && typeof summary === 'object' ? summary : {};
  const fields = ['what_worked', 'what_failed', 'tools_workflow', 'next_step'];
  const out = { what_worked: [], what_failed: [], tools_workflow: [], next_step: [] };

  for (const f of fields) {
    const list = Array.isArray(s[f]) ? s[f] : [];
    for (const item of list) {
      if (typeof item !== 'string') continue;
      const frags = splitOne(item);
      for (const frag of frags) out[f].push(frag);
    }
  }

  return out;
}
