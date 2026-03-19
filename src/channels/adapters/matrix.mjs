import { createCAPAdapter } from '../capAdapter.mjs';

export const matrixAdapter = createCAPAdapter({
  channel: 'matrix',

  normalize(inbound = {}) {
    const user_id = String(inbound?.sender ?? inbound?.user_id ?? '').trim();
    const text = String(inbound?.content?.body ?? inbound?.body ?? inbound?.text ?? '').trim();

    return {
      user_id: user_id || 'unknown',
      agent_id: null,
      session_id: String(inbound?.room_id ?? inbound?.roomId ?? inbound?.session_id ?? '') || null,
      channel: 'matrix',
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
