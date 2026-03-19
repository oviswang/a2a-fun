import { createBaseAdapter } from './baseAdapter.mjs';

export const whatsappAdapter = {
  ...createBaseAdapter({ channel: 'whatsapp' }),

  normalizeInbound(inbound = {}) {
    // WhatsApp (Baileys/OpenClaw) often provides: { chat_id, sender_id, message_id, text }
    const user_id = String(inbound?.sender_id ?? inbound?.chat_id ?? inbound?.user_id ?? '');
    const text = inbound?.text ?? inbound?.message?.conversation ?? inbound?.message?.extendedTextMessage?.text ?? '';
    return createBaseAdapter({ channel: 'whatsapp' }).normalizeInbound({ user_id, text, metadata: { raw: inbound } });
  }
};
