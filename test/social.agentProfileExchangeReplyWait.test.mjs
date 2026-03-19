import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createRelayServerV2 } from '../src/relay/relayServerV2.mjs';
import { createRelayClient } from '../src/runtime/transport/relayClient.mjs';
import { __resetRelaySingletonForTests } from '../src/runtime/network/relaySingleton.mjs';
import { sendAgentProfileExchange } from '../src/social/agentProfileExchangeSender.mjs';
import { createAgentProfileExchangeMessage } from '../src/social/agentProfileExchangeMessage.mjs';

async function exists(p) {
  try { await fs.stat(p); return true; } catch { return false; }
}

test.skip('profile exchange sender waits and receives exactly one turn-2 reply', async () => {
  __resetRelaySingletonForTests();
  const srv = createRelayServerV2({ bindHost: '127.0.0.1', port: 0, wsPath: '/relay' });
  await srv.start();
  const addr = srv.address();
  const relayUrl = `ws://127.0.0.1:${addr.port}/relay`;

  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-pex-wait-'));

  // Remote client that replies once.
  const remoteId = 'nodeB';
  const localId = 'nodeA';

  const remoteClient = createRelayClient({
    relayUrl,
    nodeId: remoteId,
    registrationMode: 'v2',
    sessionId: `sess:${remoteId}`,
    onForward: async ({ from, payload }) => {
      if (!payload || payload.kind !== 'AGENT_PROFILE_EXCHANGE') return;
      if (payload.turn !== 1) return;
      const reply = createAgentProfileExchangeMessage({
        dialogue_id: payload.dialogue_id,
        turn: 2,
        from_agent_id: remoteId,
        to_agent_id: localId,
        name: 'B',
        mission: '',
        summary: '',
        skills: [],
        current_focus: 'focus',
        prompt: 'reply',
        message: 'ok',
        timestamp: new Date().toISOString()
      });
      await remoteClient.relay({ to: localId, payload: reply.message });
    }
  });

  await remoteClient.connect();

  const local_profile = {
    agent_id: localId,
    name: 'A',
    mission: 'm',
    summary: 's',
    skills: ['echo'],
    current_focus: ''
  };

  const out = await sendAgentProfileExchange({
    local_profile,
    remote_agent_id: remoteId,
    relayUrl,
    prompt: 'test',
    workspace_path: ws,
    replyTimeoutMs: 1500
  });

  assert.equal(out.ok, true);
  assert.equal(out.reply_received, true);
  assert.equal(out.reply.turn, 2);

  const safeId = out.message.dialogue_id;
  const mdPath = path.join(ws, 'transcripts', `profile-exchange-${safeId}.md`);
  assert.equal(await exists(mdPath), true);

  await remoteClient.close();
  await srv.close();
});
