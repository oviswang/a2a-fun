function reverseString(s) {
  return String(s).split('').reverse().join('');
}

export function text_transform(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: { code: 'INVALID_INPUT' } };
  }

  const { text, mode } = input;
  if (typeof text !== 'string') {
    return { ok: false, error: { code: 'MISSING_TEXT' } };
  }
  if (typeof mode !== 'string') {
    return { ok: false, error: { code: 'MISSING_MODE' } };
  }

  if (mode === 'uppercase') return { ok: true, result: text.toUpperCase() };
  if (mode === 'lowercase') return { ok: true, result: text.toLowerCase() };
  if (mode === 'reverse') return { ok: true, result: reverseString(text) };

  return { ok: false, error: { code: 'UNKNOWN_MODE' } };
}
