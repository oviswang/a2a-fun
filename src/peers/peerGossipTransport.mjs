import { createRelayClient } from '../runtime/transport/relayClient.mjs';
import { buildPeerGossipPayload } from './peerGossip.mjs';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

export async function sendPeerGossip({ relayUrl = 'wss://bootstrap.a2a.fun/relay', from_node_id, to_node_id, peers } = {}) {
  const from = safeStr(from_node_id);
  const to = safeStr(to_node_id);
  if (!from || !to) return { ok: false, error: { code: 'MISSING_NODE_IDS' } };

  const built = buildPeerGossipPayload({ node_id: from, relayUrl, peers });

  const client = createRelayClient({
    relayUrl,
    nodeId: from,
    registrationMode: 'v2',
    sessionId: `sess:${from}:peergossip`,
    onForward: () => {}
  });
  await client.connect();
  await client.relay({ to, payload: built.payload });
  await client.close();

  console.log(JSON.stringify({ ok: true, event: 'PEER_GOSSIP_SENT', from, to, count: built.payload.peers.length }));
  return { ok: true };
}
