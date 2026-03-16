function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

function pickTexts(items, minScore) {
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const text = typeof it.text === 'string' ? it.text.trim() : '';
    const cs = typeof it.confidence_score === 'number' ? it.confidence_score : 0.5;
    if (!text) continue;
    if (cs < minScore) continue;
    out.push({ text, confidence_score: cs });
  }
  // already sorted by score in query, but keep deterministic here too
  out.sort((a, b) => (b.confidence_score - a.confidence_score) || (a.text < b.text ? -1 : 1));
  return out;
}

export function deriveDecisionFromExperience({ topic, knowledge } = {}) {
  const tp = String(topic || '').trim();
  const k = knowledge && typeof knowledge === 'object' ? knowledge : {};

  const minScore = 0.4;
  const seen = new Set();
  const decisions = [];

  const addFrom = (list) => {
    for (const it of pickTexts(list, minScore)) {
      const key = it.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      decisions.push(it.text);
      if (decisions.length >= 3) return true;
    }
    return false;
  };

  // operational priority: next_step > tools_workflow > what_worked
  if (addFrom(safeArr(k.next_step))) return { topic: tp, decisions };
  if (addFrom(safeArr(k.tools_workflow))) return { topic: tp, decisions };
  addFrom(safeArr(k.what_worked));

  return { topic: tp, decisions };
}
