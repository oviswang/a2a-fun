import { createBaseAdapter } from './baseAdapter.mjs';

export const qqAdapter = {
  ...createBaseAdapter({ channel: 'qq' }),

  normalizeInbound(inbound = {}) {
    // Accept { user_id, text } or common bot shapes { sender: { user_id }, message }
    const user_id = String(inbound?.sender?.user_id ?? inbound?.user_id ?? '');
    const text = inbound?.message ?? inbound?.text ?? '';
    return createBaseAdapter({ channel: 'qq' }).normalizeInbound({ user_id, text, metadata: { raw: inbound } });
  }
};
