import { createRelayClient } from '../runtime/transport/relayClient.mjs';
import { createAgentHandshakeMessage } from './agentHandshakeMessage.mjs';

function nowIso() {
  return new Date().toISOString();
}

function fail(code) {
  return { ok: false, sent: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

/**
 * sendAgentHandshake({ local_agent, remote_agent, relayUrl })
 *
 * local_agent: { agent_id, name, mission, skills }
 * remote_agent: { agent_id }
 */
export async function sendAgentHandshake({ local_agent, remote_agent, relayUrl } = {}) {
  const from_agent_id = local_agent?.agent_id;
  const to_agent_id = remote_agent?.agent_id;

  const msgOut = createAgentHandshakeMessage({
    from_agent_id,
    to_agent_id,
    name: local_agent?.name || '',
    mission: local_agent?.mission || '',
    skills: Array.isArray(local_agent?.skills) ? local_agent.skills : [],
    timestamp: nowIso()
  });
  if (!msgOut.ok) return fail(msgOut.error?.code || 'HANDSHAKE_BUILD_FAILED');

  const client = createRelayClient({
    relayUrl,
    nodeId: String(from_agent_id).trim(),
    registrationMode: 'v2',
    sessionId: `sess:${String(from_agent_id).trim()}`,
    onForward: () => {}
  });

  try {
    await client.connect();
    await client.relay({ to: String(to_agent_id).trim(), payload: msgOut.message });
    console.log(JSON.stringify({ ok: true, event: 'AGENT_HANDSHAKE_SENT', from_agent_id, to_agent_id, ts: msgOut.message.timestamp }));
    return { ok: true, sent: true, handshake: msgOut.message, error: null };
  } catch (e) {
    return { ok: false, sent: false, error: { code: e?.code || 'HANDSHAKE_SEND_FAILED' } };
  } finally {
    await client.close().catch(() => {});
  }
}
