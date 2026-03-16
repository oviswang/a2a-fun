function safeList(v) {
  // Accept either string[] or {text, confidence_score}[]
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v) {
    if (typeof item === 'string') {
      const t = item.trim();
      if (t) out.push(t);
      continue;
    }
    if (item && typeof item === 'object' && typeof item.text === 'string') {
      const t = item.text.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

function addLines(lines, title, items, maxItems) {
  const list = safeList(items).slice(0, maxItems);
  if (!list.length) return;
  lines.push(title);
  for (const s of list) lines.push(`- ${s}`);
  lines.push('');
}

export function buildExperienceContext({ topic = '', knowledge } = {}) {
  const tp = String(topic || '').trim();
  const k = knowledge && typeof knowledge === 'object' ? knowledge : {};

  const lines = [];
  lines.push('EXPERIENCE_CONTEXT');
  if (tp) lines.push(`Topic: ${tp}`);
  lines.push('');

  addLines(lines, 'Known successful patterns:', k.what_worked, 3);
  addLines(lines, 'Known failure patterns:', k.what_failed, 3);
  addLines(lines, 'Tools / workflow hints:', k.tools_workflow, 3);
  addLines(lines, 'Suggested safeguards:', k.next_step, 2);

  lines.push('Guideline:');
  lines.push('Use these observations as prior operational experience when reasoning.');

  let text = lines.join('\n').trim();

  // Hard cap 500 chars
  if (text.length > 500) {
    text = text.slice(0, 497).trimEnd() + '...';
  }

  return text;
}
