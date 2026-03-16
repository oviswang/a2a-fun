function safeList(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : [];
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
