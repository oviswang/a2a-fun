import { createRelayClient } from '../runtime/transport/relayClient.mjs';
import { buildTaskAcceptedPayload } from './taskClaim.mjs';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

export async function sendTaskAccepted({ relayUrl = 'wss://bootstrap.a2a.fun/relay', from_node_id, to_node_id, task_id, lease } = {}) {
  const from = safeStr(from_node_id);
  const to = safeStr(to_node_id);
  const built = buildTaskAcceptedPayload({ task_id, holder: from, lease });
  if (!built.ok) return { ok: false, error: built.error };

  const client = createRelayClient({
    relayUrl,
    nodeId: from,
    registrationMode: 'v2',
    sessionId: `sess:${from}:taskclaim`,
    onForward: () => {}
  });
  await client.connect();
  await client.relay({ to, payload: built.payload });
  await client.close();

  console.log(JSON.stringify({ ok: true, event: 'A2A_TASK_ACCEPTED_SENT', task_id: safeStr(task_id), from, to }));
  return { ok: true };
}
