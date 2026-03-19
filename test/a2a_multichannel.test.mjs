import test from 'node:test';
import assert from 'node:assert/strict';

import { listAdapters, getAdapter } from '../src/channels/adapterRegistry.mjs';
import { a2aCoreHandleMessage } from '../src/core/a2aCore.mjs';

function expectStandard(m) {
  assert.equal(typeof m.user_id, 'string');
  assert.ok(m.user_id.length > 0);
  assert.equal(typeof m.channel, 'string');
  assert.ok(m.channel.length > 0);
  assert.equal(typeof m.text, 'string');
  assert.equal(typeof m.metadata, 'object');
}

test('adapters_created: registry has all required channels', () => {
  const names = listAdapters();
  // Spec set
  for (const ch of ['lark', 'telegram', 'discord', 'whatsapp', 'wechat', 'qq', 'matrix']) {
    assert.ok(names.includes(ch), `missing adapter: ${ch}`);
  }
});

test('message_normalization: each adapter produces StandardMessage', () => {
  for (const ch of ['lark', 'telegram', 'discord', 'whatsapp', 'wechat', 'qq', 'matrix']) {
    const a = getAdapter(ch);
    assert.ok(a);
    const std = a.normalizeInbound({ user_id: 'u1', text: 'ping' });
    expectStandard(std);
    assert.equal(std.channel, ch);
  }
});

test('execution_bridge: ping works across channels', async () => {
  for (const ch of ['lark', 'telegram', 'discord', 'whatsapp', 'wechat', 'qq', 'matrix']) {
    const res = await a2aCoreHandleMessage({ user_id: 'u1', channel: ch, text: 'ping', metadata: {} });
    assert.equal(res.status, 'ok');
    assert.equal(res.result.pong, true);
  }
});

test('intent_task_mapping: runtime_status works', async () => {
  const res = await a2aCoreHandleMessage({ user_id: 'u1', channel: 'telegram', text: '帮我检查状态', metadata: {} });
  assert.equal(res.status, 'ok');
  assert.ok(res.result.node_id);
  assert.ok(res.result.local_agent_id);
  assert.ok(res.result.a2a_agent_id);
});
