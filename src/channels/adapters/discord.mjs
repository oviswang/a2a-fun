import { createCAPAdapter } from '../capAdapter.mjs';

export const discordAdapter = createCAPAdapter({
  channel: 'discord',

  normalize(inbound = {}) {
    const user_id = String(inbound?.author?.id ?? inbound?.user?.id ?? inbound?.user_id ?? '').trim();
    const text = String(inbound?.content ?? inbound?.text ?? '').trim();

    return {
      user_id: user_id || 'unknown',
      agent_id: null,
      session_id: String(inbound?.channel_id ?? inbound?.channelId ?? inbound?.thread_id ?? '') || null,
      channel: 'discord',
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
