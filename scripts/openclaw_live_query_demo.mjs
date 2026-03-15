import crypto from 'node:crypto';
import { createRelayClient } from '../src/runtime/transport/relayClient.mjs';
import { createOpenClawLiveQueryRequest } from '../src/openclaw/openclawLiveQueryMessages.mjs';

function nowIso() {
  return new Date().toISOString();
}

const relayUrl = process.env.RELAY_URL || 'wss://bootstrap.a2a.fun/relay';
const fromId = process.env.A2A_AGENT_ID || 'VM-0-13-ubuntu';
const toId = process.env.TO_AGENT_ID || 'VM-0-13-ubuntu';

const request_id = `ocq:${crypto.randomUUID()}`;

const inbox = [];
const client = createRelayClient({
  relayUrl,
  nodeId: fromId,
  registrationMode: 'v2',
  sessionId: `sess:${fromId}:ocq-demo`,
  onForward: ({ from, payload }) => inbox.push({ from, payload })
});

await client.connect();

const req = createOpenClawLiveQueryRequest({
  request_id,
  from_agent_id: fromId,
  to_agent_id: toId,
  question_type: 'current_focus',
  question_text: 'What is your current focus and one practical lesson learned recently?',
  created_at: nowIso()
});

await client.relay({ to: toId, payload: req.message });

const start = Date.now();
while (Date.now() - start < 20000) {
  const idx = inbox.findIndex((m) => m.payload?.kind === 'OPENCLAW_LIVE_QUERY_REPLY' && m.payload.request_id === request_id);
  if (idx !== -1) {
    console.log(JSON.stringify({ ok: true, reply: inbox[idx].payload }, null, 2));
    await client.close();
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 50));
}

console.log(JSON.stringify({ ok: false, error: { code: 'TIMEOUT' } }, null, 2));
await client.close();
process.exit(1);
