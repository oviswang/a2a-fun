export async function deliverSocialFeedMessage({
  gateway,
  channel_id,
  message,
  send
} = {}) {
  if (typeof send !== 'function') {
    return { ok: false, delivered: false, error: { code: 'MISSING_SEND' } };
  }
  if (typeof message !== 'string' || !message.trim()) {
    return { ok: false, delivered: false, error: { code: 'INVALID_MESSAGE' } };
  }

  const g = typeof gateway === 'string' ? gateway.trim().toLowerCase() : '';
  if (!g || g === 'unknown') {
    return { ok: false, delivered: false, error: { code: 'UNKNOWN_GATEWAY' } };
  }

  try {
    const out = await send({ gateway: g, channel_id: channel_id ?? null, message });
    return { ok: true, delivered: true, error: null, send_result: out ?? null };
  } catch (e) {
    const code = (e && typeof e.code === 'string' && e.code.slice(0, 64)) || 'SEND_FAILED';
    return { ok: false, delivered: false, error: { code } };
  }
}
