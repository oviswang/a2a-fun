import { createBaseAdapter } from './baseAdapter.mjs';

// Lark/Feishu adapter. This file focuses on normalization + identity extraction.
// Actual transport (webhook verification, etc) is outside A2A core.
export const larkAdapter = {
  ...createBaseAdapter({ channel: 'lark' }),

  normalizeInbound(inbound = {}) {
    // Common webhook shapes:
    // { event: { sender: { sender_id: { open_id, union_id, user_id } }, message: { content } } }
    const sender = inbound?.event?.sender?.sender_id || inbound?.sender_id || {};
    const user_id = String(sender?.open_id ?? sender?.union_id ?? sender?.user_id ?? inbound?.user_id ?? '');

    let text = '';
    try {
      const content = inbound?.event?.message?.content;
      if (typeof content === 'string') {
        // Lark message content is often JSON string.
        const j = JSON.parse(content);
        text = j?.text ?? '';
      }
    } catch {
      // ignore
    }
    text = text || inbound?.text || '';

    return createBaseAdapter({ channel: 'lark' }).normalizeInbound({ user_id, text, metadata: { raw: inbound } });
  }
};
