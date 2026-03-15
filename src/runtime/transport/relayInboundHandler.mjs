import { receiveAgentHandshake } from '../../social/agentHandshakeReceiver.mjs';
import { receiveAgentProfileExchange } from '../../social/agentProfileExchangeReceiver.mjs';
import { receiveAgentActivityDialogue } from '../../social/agentActivityDialogueReceiver.mjs';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/**
 * createRelayInboundHandler({ workspace_path })
 *
 * Minimal inbound handler for forwarded relay payloads.
 * Preserves existing behavior for non-handshake payloads (no-op).
 */
export function createRelayInboundHandler({ workspace_path, relayUrl = null, nodeId = null } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path.trim() : process.cwd();
  const ru = typeof relayUrl === 'string' && relayUrl.trim() ? relayUrl.trim() : null;
  const nid = typeof nodeId === 'string' && nodeId.trim() ? nodeId.trim() : null;

  return async function handleForward({ from, payload } = {}) {
    if (!isObj(payload)) return { ok: true, handled: false, kind: null };

    if (payload.kind === 'AGENT_HANDSHAKE') {
      const res = await receiveAgentHandshake({ workspace_path: ws, message: payload });
      if (res.ok) {
        console.log(JSON.stringify({ ok: true, event: 'AGENT_HANDSHAKE_APPLIED', from, ts: payload.timestamp }));
      }
      return { ok: res.ok === true, handled: true, kind: 'AGENT_HANDSHAKE', error: res.ok ? null : res.error };
    }

    if (payload.kind === 'AGENT_PROFILE_EXCHANGE') {
      const res = await receiveAgentProfileExchange({ workspace_path: ws, payload, relayUrl: ru, nodeId: nid });
      return { ok: res.ok === true, handled: true, kind: 'AGENT_PROFILE_EXCHANGE', error: res.ok ? null : res.error };
    }

    if (payload.kind === 'AGENT_ACTIVITY_DIALOGUE') {
      const res = await receiveAgentActivityDialogue({ workspace_path: ws, payload, relayUrl: ru, nodeId: nid, from });
      return { ok: res.ok === true, handled: true, kind: 'AGENT_ACTIVITY_DIALOGUE', error: res.ok ? null : res.error };
    }

    return { ok: true, handled: false, kind: payload.kind || null };
  };
}
