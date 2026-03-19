import { normalizeStandardMessage } from '../../core/standardMessage.mjs';

// OpenClaw inbound meta provides chat_id + channel; text passed separately.
// We keep this adapter permissive so it works across WhatsApp/Telegram/Discord/etc.
export const openclawAdapter = {
  channel: 'openclaw',

  normalizeInbound(inbound = {}) {
    const channel = String(inbound.channel || inbound.provider || inbound.surface || '').trim() || 'unknown';
    const user_id = String(inbound.chat_id || inbound.sender_id || inbound.user_id || '').trim();
    const text = typeof inbound.text === 'string' ? inbound.text : String(inbound.message || inbound.body || '');

    return normalizeStandardMessage({
      user_id: user_id || 'unknown',
      channel,
      text,
      metadata: {
        account_id: inbound.account_id || null,
        chat_type: inbound.chat_type || null,
        message_id: inbound.message_id || null,
        raw: inbound.metadata || null
      }
    });
  },

  formatOutbound({ result } = {}) {
    // Return plain text; channel plugin handles formatting.
    if (!result) return { text: '' };
    if (result.status !== 'ok') {
      return { text: `A2A error: ${result.error?.code || result.status || 'unknown'}` };
    }
    return { text: typeof result.result === 'string' ? result.result : JSON.stringify(result.result) };
  }
};
