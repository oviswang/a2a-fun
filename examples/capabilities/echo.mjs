export function echo(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: { code: 'INVALID_INPUT' } };
  }
  const text = input.text;
  if (typeof text !== 'string') {
    return { ok: false, error: { code: 'MISSING_TEXT' } };
  }
  return { ok: true, result: { text } };
}
