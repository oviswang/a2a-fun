import { createCAPAdapter } from '../capAdapter.mjs';

export const qqAdapter = createCAPAdapter({
  channel: 'qq',

  normalize(inbound = {}) {
    const user_id = String(inbound?.sender?.user_id ?? inbound?.user_id ?? '').trim();
    const text = String(inbound?.message ?? inbound?.text ?? '').trim();

    return {
      user_id: user_id || 'unknown',
      agent_id: null,
      session_id: String(inbound?.group_id ?? inbound?.channel_id ?? inbound?.session_id ?? '') || null,
      channel: 'qq',
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
