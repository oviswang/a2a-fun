import test from 'node:test';
import assert from 'node:assert/strict';

import { bootstrapGetPeers } from '../src/runtime/bootstrap/bootstrapClient.mjs';

function withGlobals(temp, fn) {
  const prev = {
    ctx: globalThis.__A2A_SOCIAL_CONTEXT,
    send: globalThis.__A2A_SOCIAL_SEND,
    agent: globalThis.__A2A_AGENT_ID
  };
  Object.assign(globalThis, temp);
  return Promise.resolve(fn()).finally(() => {
    globalThis.__A2A_SOCIAL_CONTEXT = prev.ctx;
    globalThis.__A2A_SOCIAL_SEND = prev.send;
    globalThis.__A2A_AGENT_ID = prev.agent;
  });
}

test('social feed wiring: discovered_agent emitted from bootstrapGetPeers (best-effort)', async () => {
  const messages = [];

  await withGlobals(
    {
      __A2A_SOCIAL_CONTEXT: { channel: 'telegram', chat_id: 'c1' },
      __A2A_AGENT_ID: 'nodeA',
      __A2A_SOCIAL_SEND: async ({ message }) => {
        messages.push(message);
        return { ok: true };
      }
    },
    async () => {
      const out = await bootstrapGetPeers({
        bootstrapUrl: 'https://bootstrap.a2a.fun',
        httpClient: async () => ({
          status: 200,
          ok: true,
          async json() {
            return { ok: true, peers: ['https://nodeB.example.com'] };
          }
        })
      });

      assert.equal(out.ok, true);
      assert.deepEqual(out.peers, ['https://nodeb.example.com/']);
    }
  );

  await new Promise((r) => setTimeout(r, 50));
  assert.equal(messages.length >= 1, true);
  assert.match(messages[0], /I found an agent/);
});
