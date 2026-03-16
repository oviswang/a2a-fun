import { createRelayClient } from '../runtime/transport/relayClient.mjs';
import { buildTaskPublishedMessage, buildTaskResultMessage } from './taskMessages.mjs';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

export async function sendTaskPublished({ relayUrl = 'wss://bootstrap.a2a.fun/relay', from_peer_id, to_peer_id, task } = {}) {
  const from = safeStr(from_peer_id);
  const to = safeStr(to_peer_id);
  if (!from || !to) return { ok: false, error: { code: 'MISSING_PEER_IDS' } };

  const built = buildTaskPublishedMessage({ task, from_peer_id: from });
  if (!built.ok) return { ok: false, error: built.error };

  const client = createRelayClient({
    relayUrl,
    nodeId: from,
    registrationMode: 'v2',
    sessionId: `sess:${from}:tasktx`,
    onForward: () => {}
  });
  await client.connect();
  await client.relay({ to, payload: built.message });
  await client.close();

  return { ok: true };
}

export async function sendTaskResult({ relayUrl = 'wss://bootstrap.a2a.fun/relay', from_peer_id, to_peer_id, task_id, final_status, result, error } = {}) {
  const from = safeStr(from_peer_id);
  const to = safeStr(to_peer_id);
  if (!from || !to) return { ok: false, error: { code: 'MISSING_PEER_IDS' } };

  const built = buildTaskResultMessage({ task_id, from_peer_id: from, to_peer_id: to, final_status, result, error });
  if (!built.ok) return { ok: false, error: built.error };

  const client = createRelayClient({
    relayUrl,
    nodeId: from,
    registrationMode: 'v2',
    sessionId: `sess:${from}:tasktx`,
    onForward: () => {}
  });
  await client.connect();
  await client.relay({ to, payload: built.message });
  await client.close();

  return { ok: true };
}
