export function parseSocialFeedReply({ text } = {}) {
  const s = typeof text === 'string' ? text.trim() : '';

  if (s === '1') return { ok: true, action: 'continue' };
  if (s === '2') return { ok: true, action: 'join' };
  if (s === '3') return { ok: true, action: 'skip' };

  return { ok: false, error: { code: 'INVALID_REPLY' } };
}
