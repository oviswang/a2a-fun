import test from 'node:test';
import assert from 'node:assert/strict';

import { deliverSocialFeedMessage } from '../src/social/socialFeedDelivery.mjs';

test('social feed delivery: unknown gateway fails closed', async () => {
  const out = await deliverSocialFeedMessage({
    gateway: 'unknown',
    channel_id: null,
    message: 'hi',
    send: async () => ({ ok: true })
  });
  assert.equal(out.ok, false);
  assert.equal(out.delivered, false);
  assert.equal(out.error.code, 'UNKNOWN_GATEWAY');
});

test('social feed delivery: injected send is called', async () => {
  let called = false;
  const out = await deliverSocialFeedMessage({
    gateway: 'telegram',
    channel_id: 'c1',
    message: 'hello',
    send: async ({ gateway, channel_id, message }) => {
      called = true;
      assert.equal(gateway, 'telegram');
      assert.equal(channel_id, 'c1');
      assert.equal(message, 'hello');
      return { ok: true };
    }
  });
  assert.equal(called, true);
  assert.equal(out.ok, true);
  assert.equal(out.delivered, true);
});
