function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * StandardMessage contract (CAP v0.3.5):
 * {
 *   user_id: string,
 *   agent_id: string,     // stable A2A agent id for this user (cross-channel)
 *   session_id: string,   // stable per channel session/thread/conversation id
 *   channel: string,
 *   text: string,
 *   metadata: object
 * }
 */
export function normalizeStandardMessage(msg) {
  if (!isPlainObject(msg)) throw err('INVALID_MESSAGE', 'message must be object');

  const user_id = typeof msg.user_id === 'string' ? msg.user_id.trim() : '';
  const agent_id = typeof msg.agent_id === 'string' ? msg.agent_id.trim() : '';
  const session_id = typeof msg.session_id === 'string' ? msg.session_id.trim() : '';
  const channel = typeof msg.channel === 'string' ? msg.channel.trim() : '';
  const text = typeof msg.text === 'string' ? msg.text : '';
  const metadata = isPlainObject(msg.metadata) ? msg.metadata : {};

  if (!user_id) throw err('INVALID_MESSAGE', 'missing user_id');
  if (!channel) throw err('INVALID_MESSAGE', 'missing channel');

  // Do not keep platform-specific formatting. Minimal cleanup only; adapters should do the heavy lifting.
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();

  return {
    user_id,
    agent_id: agent_id || null,
    session_id: session_id || null,
    channel,
    text: cleaned,
    metadata
  };
}
