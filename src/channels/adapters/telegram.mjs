import { createCAPAdapter } from '../capAdapter.mjs';

export const telegramAdapter = createCAPAdapter({
  channel: 'telegram',

  normalize(inbound = {}) {
    const user_id = String(
      inbound?.from?.id ?? inbound?.message?.from?.id ?? inbound?.chat?.id ?? inbound?.message?.chat?.id ?? inbound?.user_id ?? ''
    ).trim();
    const text = String(inbound?.text ?? inbound?.message?.text ?? '').trim();

    return {
      user_id: user_id || 'unknown',
      agent_id: null,
      session_id: String(inbound?.chat?.id ?? inbound?.message?.chat?.id ?? '') || null,
      channel: 'telegram',
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
