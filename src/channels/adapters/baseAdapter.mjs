import { normalizeStandardMessage } from '../../core/standardMessage.mjs';

/**
 * Adapter contract:
 * - normalizeInbound(inbound) => StandardMessage
 * - formatOutbound({ result }) => { text, metadata? }
 */
export function createBaseAdapter({ channel } = {}) {
  const ch = String(channel || '').trim();
  if (!ch) throw new Error('missing channel');

  return {
    channel: ch,

    normalizeInbound(inbound) {
      // Default: accept already-standard messages.
      return normalizeStandardMessage({
        user_id: inbound?.user_id,
        channel: ch,
        text: inbound?.text,
        metadata: inbound?.metadata || {}
      });
    },

    formatOutbound({ result } = {}) {
      const status = result?.status || 'ok';
      const text = typeof result?.result === 'string' ? result.result : JSON.stringify(result?.result ?? null);
      if (status !== 'ok') {
        return { text: `ERROR(${status}): ${text}` };
      }
      return { text };
    }
  };
}
