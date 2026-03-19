import { createCAPAdapter } from '../capAdapter.mjs';

export const openclawAdapter = createCAPAdapter({
  channel: 'openclaw',

  normalize(inbound = {}) {
    const channel = String(inbound.channel || inbound.provider || inbound.surface || '').trim() || 'unknown';
    const user_id = String(inbound.chat_id || inbound.sender_id || inbound.user_id || '').trim() || 'unknown';
    const text = typeof inbound.text === 'string' ? inbound.text : String(inbound.message || inbound.body || '');

    return {
      user_id,
      // agent_id/session_id resolved in bindIdentity
      agent_id: null,
      session_id: String(inbound.thread_id || inbound.threadId || '') || null,
      channel,
      text,
      metadata: {
        account_id: inbound.account_id || null,
        chat_type: inbound.chat_type || null,
        message_id: inbound.message_id || null,
        raw: inbound.metadata || null
      }
    };
  },

  formatResponse(result) {
    if (!result) return { text: '' };
    if (result.status !== 'ok') {
      return { text: `A2A error: ${result.error?.code || result.status || 'unknown'}` };
    }
    return { text: typeof result.result === 'string' ? result.result : JSON.stringify(result.result) };
  }
});
