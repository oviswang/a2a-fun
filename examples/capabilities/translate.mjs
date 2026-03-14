const DICT_ZH = {
  hello: '你好',
  world: '世界'
};

export function translate(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: { code: 'INVALID_INPUT' } };
  }

  const { text, to } = input;
  if (typeof text !== 'string') {
    return { ok: false, error: { code: 'MISSING_TEXT' } };
  }
  if (typeof to !== 'string') {
    return { ok: false, error: { code: 'MISSING_TO' } };
  }

  if (to !== 'zh') {
    return { ok: false, error: { code: 'UNSUPPORTED_LANGUAGE' } };
  }

  // Small dictionary only. Translate word-by-word; unknown tokens pass through.
  const out = text
    .split(/(\s+)/)
    .map((tok) => {
      if (/^\s+$/.test(tok)) return tok;
      const key = tok.toLowerCase();
      return DICT_ZH[key] || tok;
    })
    .join('');

  return { ok: true, result: out };
}
