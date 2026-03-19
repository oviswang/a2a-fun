import { createBaseAdapter } from './baseAdapter.mjs';

export const discordAdapter = {
  ...createBaseAdapter({ channel: 'discord' }),

  normalizeInbound(inbound = {}) {
    // Discord shapes vary; accept { author: { id }, content } or { user_id, text }
    const user_id = String(inbound?.author?.id ?? inbound?.user?.id ?? inbound?.user_id ?? '');
    const text = inbound?.content ?? inbound?.text ?? '';
    return createBaseAdapter({ channel: 'discord' }).normalizeInbound({ user_id, text, metadata: { raw: inbound } });
  }
};
