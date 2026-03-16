import { receiveAgentHandshake } from '../../social/agentHandshakeReceiver.mjs';
import { receiveAgentProfileExchange } from '../../social/agentProfileExchangeReceiver.mjs';
import { receiveAgentActivityDialogue } from '../../social/agentActivityDialogueReceiver.mjs';
import { receiveAgentExperienceDialogue } from '../../social/agentExperienceDialogueReceiver.mjs';
import { receiveOpenClawLiveQuery } from '../../openclaw/openclawLiveQueryReceiver.mjs';
import { receiveTaskPublished, receiveTaskResult } from '../../tasks/taskReceiver.mjs';
import { receiveTaskSyncRequest, receiveTaskSyncResponse } from '../../tasks/taskSync.mjs';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/**
 * createRelayInboundHandler({ workspace_path })
 *
 * Minimal inbound handler for forwarded relay payloads.
 * Preserves existing behavior for non-handshake payloads (no-op).
 */
export function createRelayInboundHandler({ workspace_path, relayUrl = null, nodeId = null, relayClient = null } = {}) {
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
      const res = await receiveAgentActivityDialogue({ workspace_path: ws, payload, relayUrl: ru, nodeId: nid, from, relayClient });
      return { ok: res.ok === true, handled: true, kind: 'AGENT_ACTIVITY_DIALOGUE', error: res.ok ? null : res.error };
    }

    if (payload.kind === 'AGENT_EXPERIENCE_DIALOGUE') {
      const res = await receiveAgentExperienceDialogue({ workspace_path: ws, payload, relayUrl: ru, nodeId: nid, from, relayClient });
      return { ok: res.ok === true, handled: true, kind: 'AGENT_EXPERIENCE_DIALOGUE', error: res.ok ? null : res.error };
    }

    if (payload.kind === 'OPENCLAW_LIVE_QUERY_REQUEST') {
      const res = await receiveOpenClawLiveQuery({ workspace_path: ws, payload, relayUrl: ru, nodeId: nid, relayClient });
      return { ok: res.ok === true, handled: true, kind: 'OPENCLAW_LIVE_QUERY_REQUEST', error: res.ok ? null : res.error };
    }

    if (payload.kind === 'A2A_TASK_PUBLISHED') {
      const res = await receiveTaskPublished({ workspace_path: ws, payload });
      return { ok: res.ok === true, handled: true, kind: 'A2A_TASK_PUBLISHED', error: res.ok ? null : res.error };
    }

    if (payload.kind === 'A2A_TASK_RESULT') {
      const res = await receiveTaskResult({ workspace_path: ws, payload });
      return { ok: res.ok === true, handled: true, kind: 'A2A_TASK_RESULT', error: res.ok ? null : res.error };
    }

    if (payload.kind === 'A2A_TASK_SYNC_REQUEST') {
      const res = await receiveTaskSyncRequest({ workspace_path: ws, payload });
      if (res.ok && res.response && relayClient && from) {
        await relayClient.relay({ to: from, payload: res.response });
      }
      return { ok: res.ok === true, handled: true, kind: 'A2A_TASK_SYNC_REQUEST', error: res.ok ? null : res.error };
    }

    if (payload.kind === 'A2A_TASK_SYNC_RESPONSE') {
      const res = await receiveTaskSyncResponse({ workspace_path: ws, payload });
      return { ok: res.ok === true, handled: true, kind: 'A2A_TASK_SYNC_RESPONSE', error: res.ok ? null : res.error };
    }

    return { ok: true, handled: false, kind: payload.kind || null };
  };
}
