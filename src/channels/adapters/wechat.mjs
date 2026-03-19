import { createCAPAdapter } from '../capAdapter.mjs';

export const wechatAdapter = createCAPAdapter({
  channel: 'wechat',

  normalize(inbound = {}) {
    const user_id = String(inbound?.FromUserName ?? inbound?.user_id ?? '').trim();
    const text = String(inbound?.Content ?? inbound?.text ?? '').trim();

    return {
      user_id: user_id || 'unknown',
      agent_id: null,
      session_id: String(inbound?.ToUserName ?? inbound?.session_id ?? '') || null,
      channel: 'wechat',
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
