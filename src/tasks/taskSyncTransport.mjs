import { createRelayClient } from '../runtime/transport/relayClient.mjs';
import { buildTaskSyncRequest } from './taskSync.mjs';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

export async function sendTaskSyncRequest({ relayUrl = 'wss://bootstrap.a2a.fun/relay', from_node_id, to_node_id, limit = 50 } = {}) {
  const from = safeStr(from_node_id);
  const to = safeStr(to_node_id);
  if (!from || !to) return { ok: false, error: { code: 'MISSING_NODE_IDS' } };

  const built = buildTaskSyncRequest({ node_id: from, limit });
  const client = createRelayClient({
    relayUrl,
    nodeId: from,
    registrationMode: 'v2',
    sessionId: `sess:${from}:tasksync`,
    onForward: () => {}
  });
  await client.connect();
  await client.relay({ to, payload: built.message });
  await client.close();
  return { ok: true };
}
