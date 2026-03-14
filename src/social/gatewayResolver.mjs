function normGateway(x) {
  const s = typeof x === 'string' ? x.trim().toLowerCase() : '';
  if (s === 'whatsapp' || s === 'telegram' || s === 'discord') return s;
  return null;
}

export function resolveActiveGateway({ context } = {}) {
  // Gateway-agnostic: rely only on shallow, optional context fields.
  // Fail closed to { gateway:'unknown', channel_id:null }.
  if (!context || typeof context !== 'object') {
    return { ok: true, gateway: 'unknown', channel_id: null };
  }

  const gateway = normGateway(context.gateway) || normGateway(context.channel) || null;
  const channel_id = typeof context.channel_id === 'string'
    ? context.channel_id
    : typeof context.chat_id === 'string'
      ? context.chat_id
      : null;

  if (!gateway) {
    return { ok: true, gateway: 'unknown', channel_id: null };
  }

  return { ok: true, gateway, channel_id };
}
