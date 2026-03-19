import { createBaseAdapter } from './baseAdapter.mjs';

export const matrixAdapter = {
  ...createBaseAdapter({ channel: 'matrix' }),

  normalizeInbound(inbound = {}) {
    // Matrix event: { sender: "@user:server", content: { body } }
    const user_id = String(inbound?.sender ?? inbound?.user_id ?? '');
    const text = inbound?.content?.body ?? inbound?.body ?? inbound?.text ?? '';
    return createBaseAdapter({ channel: 'matrix' }).normalizeInbound({ user_id, text, metadata: { raw: inbound } });
  }
};
