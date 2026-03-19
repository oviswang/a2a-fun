import { createBaseAdapter } from './baseAdapter.mjs';

// Generic Telegram adapter (for direct usage outside OpenClaw).
export const telegramAdapter = {
  ...createBaseAdapter({ channel: 'telegram' }),

  normalizeInbound(inbound = {}) {
    // Telegram common shapes:
    // { message: { from: { id }, text }, chat: { id } }
    const user_id = String(
      inbound?.from?.id ?? inbound?.message?.from?.id ?? inbound?.chat?.id ?? inbound?.message?.chat?.id ?? inbound?.user_id ?? ''
    );
    const text = inbound?.text ?? inbound?.message?.text ?? '';

    return createBaseAdapter({ channel: 'telegram' }).normalizeInbound({
      user_id,
      text,
      metadata: { raw: inbound }
    });
  }
};
