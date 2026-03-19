import { createBaseAdapter } from './baseAdapter.mjs';

// WeChat adapter (placeholder): normalization only.
// Transport differs between Official Accounts / WeCom / personal bots.
export const wechatAdapter = {
  ...createBaseAdapter({ channel: 'wechat' }),

  normalizeInbound(inbound = {}) {
    // Accept { FromUserName, Content } (OA) or { user_id, text }
    const user_id = String(inbound?.FromUserName ?? inbound?.user_id ?? '');
    const text = inbound?.Content ?? inbound?.text ?? '';
    return createBaseAdapter({ channel: 'wechat' }).normalizeInbound({ user_id, text, metadata: { raw: inbound } });
  }
};
