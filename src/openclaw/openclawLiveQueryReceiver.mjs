import { queryOpenClawLive } from './openclawLiveQueryBridge.mjs';
import { createOpenClawLiveQueryReply } from './openclawLiveQueryMessages.mjs';
import { createRelayClient } from '../runtime/transport/relayClient.mjs';

function nowIso() {
  return new Date().toISOString();
}

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

export async function receiveOpenClawLiveQuery({ workspace_path, payload, relayUrl, nodeId, relayClient = null } = {}) {
  if (!isObj(payload) || payload.kind !== 'OPENCLAW_LIVE_QUERY_REQUEST') return { ok: true, applied: false };

  if (process.env.ENABLE_OPENCLAW_LIVE_QUERY_BRIDGE !== 'true') {
    const rep = createOpenClawLiveQueryReply({
      request_id: payload.request_id,
      from_agent_id: nodeId || 'unknown',
      to_agent_id: payload.from_agent_id,
      ok: false,
      answer_text: null,
      error: { code: 'BRIDGE_DISABLED' },
      created_at: nowIso()
    });
    const client = relayClient || createRelayClient({ relayUrl, nodeId, registrationMode: 'v2' });
    if (!relayClient) await client.connect();
    await client.relay({ to: payload.from_agent_id, payload: rep.message });
    if (!relayClient) await client.close();
    return { ok: true, applied: true, replied: true };
  }

  console.log(JSON.stringify({ ok: true, event: 'OPENCLAW_LIVE_QUERY_RECEIVED', request_id: payload.request_id, question_type: payload.question_type }));

  const ans = await queryOpenClawLive({ question_type: payload.question_type, question_text: payload.question_text });

  const rep = createOpenClawLiveQueryReply({
    request_id: payload.request_id,
    from_agent_id: nodeId || 'unknown',
    to_agent_id: payload.from_agent_id,
    ok: ans.ok === true,
    answer_text: ans.ok ? ans.answer_text : null,
    error: ans.ok ? null : ans.error,
    created_at: nowIso()
  });

  const client = relayClient || createRelayClient({ relayUrl, nodeId, registrationMode: 'v2' });
  if (!relayClient) await client.connect();
  await client.relay({ to: payload.from_agent_id, payload: rep.message });
  if (!relayClient) await client.close();

  return { ok: true, applied: true, replied: true };
}
