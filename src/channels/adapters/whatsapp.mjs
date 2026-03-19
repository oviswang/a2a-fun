import { createCAPAdapter } from '../capAdapter.mjs';

export const whatsappAdapter = createCAPAdapter({
  channel: 'whatsapp',

  normalize(inbound = {}) {
    const user_id = String(inbound?.sender_id ?? inbound?.chat_id ?? inbound?.user_id ?? '').trim();
    const text = String(inbound?.text ?? inbound?.message?.conversation ?? inbound?.message?.extendedTextMessage?.text ?? '').trim();

    return {
      user_id: user_id || 'unknown',
      agent_id: null,
      session_id: String(inbound?.chat_id ?? inbound?.jid ?? '') || null,
      channel: 'whatsapp',
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
