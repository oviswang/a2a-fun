import { receiveAgentHandshake } from '../../social/agentHandshakeReceiver.mjs';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/**
 * createRelayInboundHandler({ workspace_path })
 *
 * Minimal inbound handler for forwarded relay payloads.
 * Preserves existing behavior for non-handshake payloads (no-op).
 */
export function createRelayInboundHandler({ workspace_path } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path.trim() : process.cwd();

  return async function handleForward({ from, payload } = {}) {
    if (!isObj(payload)) return { ok: true, handled: false, kind: null };

    if (payload.kind === 'AGENT_HANDSHAKE') {
      const res = await receiveAgentHandshake({ workspace_path: ws, message: payload });
      if (res.ok) {
        console.log(JSON.stringify({ ok: true, event: 'AGENT_HANDSHAKE_APPLIED', from, ts: payload.timestamp }));
      }
      return { ok: res.ok === true, handled: true, kind: 'AGENT_HANDSHAKE', error: res.ok ? null : res.error };
    }

    return { ok: true, handled: false, kind: payload.kind || null };
  };
}
