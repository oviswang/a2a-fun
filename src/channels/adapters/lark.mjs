import { createCAPAdapter } from '../capAdapter.mjs';

export const larkAdapter = createCAPAdapter({
  channel: 'lark',

  normalize(inbound = {}) {
    const sender = inbound?.event?.sender?.sender_id || inbound?.sender_id || {};
    const user_id = String(sender?.open_id ?? sender?.union_id ?? sender?.user_id ?? inbound?.user_id ?? '').trim();

    let text = '';
    try {
      const content = inbound?.event?.message?.content;
      if (typeof content === 'string') {
        const j = JSON.parse(content);
        text = j?.text ?? '';
      }
    } catch {}
    text = String(text || inbound?.text || '').trim();

    return {
      user_id: user_id || 'unknown',
      agent_id: null,
      session_id: String(inbound?.event?.message?.chat_id ?? inbound?.chat_id ?? '') || null,
      channel: 'lark',
      text,
      metadata: { raw: inbound }
    };
  },

  formatResponse(result) {
    if (!result) return { text: '' };
    if (result.status !== 'ok') return { text: `ERROR: ${result.error?.code || 'unknown'}` };
    return { text: typeof result.result === 'string' ? result.result : JSON.stringify(result.result) };
  }
});
