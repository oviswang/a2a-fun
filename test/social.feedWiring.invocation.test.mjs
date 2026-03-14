import test from 'node:test';
import assert from 'node:assert/strict';

import { handleRemoteInvocation } from '../src/remote/remoteExecutionEntry.mjs';

import { createCapabilityHandlerRegistry, registerCapabilityHandler } from '../src/execution/capabilityHandlerRegistry.mjs';

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

test('social feed wiring: invocation_received + invocation_completed emit messages (best-effort)', async () => {
  const messages = [];

  await withGlobals(
    {
      __A2A_SOCIAL_CONTEXT: { channel: 'telegram', chat_id: 'c1' },
      __A2A_AGENT_ID: 'nodeA',
      __A2A_SOCIAL_SEND: async ({ gateway, channel_id, message }) => {
        messages.push({ gateway, channel_id, message });
        return { ok: true };
      }
    },
    async () => {
      const registry = createCapabilityHandlerRegistry();
      registerCapabilityHandler({
        registry,
        capability_id: 'translate',
        handler: () => ({ ok: true })
      });

      const friendship_record = { friendship_id: 'fr_1', established: true };
      const payload = {
        kind: 'REMOTE_INVOCATION_REQUEST',
        invocation_request: {
          invocation_id: 'inv:test:1',
          capability_ref_id: 'capref:test:1',
          friendship_id: 'fr_1',
          capability_id: 'translate',
          payload: { text: 'hello', to: 'zh' }
        }
      };

      const out = handleRemoteInvocation({ payload, registry, friendship_record });
      assert.equal(out.ok, true);
    }
  );

  // Best-effort async delivery: allow microtasks to flush.
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(messages.length >= 2, true);
  assert.match(messages[0].message, /New request received from/);
  assert.match(messages[0].message, /Capability: translate/);

  // One of the later messages should be completion.
  assert.equal(messages.some((m) => /Request completed/.test(m.message)), true);
});

test('social feed wiring: delivery failure does not break invocation handling', async () => {
  await withGlobals(
    {
      __A2A_SOCIAL_CONTEXT: { channel: 'telegram', chat_id: 'c1' },
      __A2A_AGENT_ID: 'nodeA',
      __A2A_SOCIAL_SEND: async () => {
        const e = new Error('send failed');
        e.code = 'SEND_FAIL';
        throw e;
      }
    },
    async () => {
      const registry = createCapabilityHandlerRegistry();
      registerCapabilityHandler({
        registry,
        capability_id: 'translate',
        handler: () => ({ ok: true })
      });

      const friendship_record = { friendship_id: 'fr_1', established: true };
      const payload = {
        kind: 'REMOTE_INVOCATION_REQUEST',
        invocation_request: {
          invocation_id: 'inv:test:2',
          capability_ref_id: 'capref:test:2',
          friendship_id: 'fr_1',
          capability_id: 'translate',
          payload: { text: 'hello', to: 'zh' }
        }
      };

      const out = handleRemoteInvocation({ payload, registry, friendship_record });
      assert.equal(out.ok, true);
    }
  );
});
