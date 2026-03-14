import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveActiveGateway } from '../src/social/gatewayResolver.mjs';

test('gateway resolver: unknown when context missing', () => {
  const out = resolveActiveGateway({ context: null });
  assert.deepEqual(out, { ok: true, gateway: 'unknown', channel_id: null });
});

test('gateway resolver: resolves whatsapp + channel id', () => {
  const out = resolveActiveGateway({ context: { channel: 'whatsapp', chat_id: 'c1' } });
  assert.equal(out.ok, true);
  assert.equal(out.gateway, 'whatsapp');
  assert.equal(out.channel_id, 'c1');
});
