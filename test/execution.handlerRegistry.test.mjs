import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCapabilityHandlerRegistry,
  registerCapabilityHandler,
  getCapabilityHandler
} from '../src/execution/capabilityHandlerRegistry.mjs';

test('handler registry: registry can be created', () => {
  const reg = createCapabilityHandlerRegistry();
  assert.ok(reg);
  assert.ok(reg._handlers instanceof Map);
});

test('handler registry: valid capability_id + handler can be registered', () => {
  const reg = createCapabilityHandlerRegistry();
  const handler = () => 'ok';
  const r = registerCapabilityHandler({ registry: reg, capability_id: 'cap:sha256:test', handler });
  assert.deepEqual(r, { ok: true });
});

test('handler registry: registered handler can be retrieved', () => {
  const reg = createCapabilityHandlerRegistry();
  const handler = () => 'ok';
  registerCapabilityHandler({ registry: reg, capability_id: 'cap:sha256:test', handler });
  const got = getCapabilityHandler({ registry: reg, capability_id: 'cap:sha256:test' });
  assert.equal(got, handler);
});

test('handler registry: invalid capability_id fails closed', () => {
  const reg = createCapabilityHandlerRegistry();
  assert.throws(
    () => registerCapabilityHandler({ registry: reg, capability_id: '', handler: () => 1 }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => getCapabilityHandler({ registry: reg, capability_id: '' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );
});

test('handler registry: invalid handler fails closed', () => {
  const reg = createCapabilityHandlerRegistry();
  assert.throws(
    () => registerCapabilityHandler({ registry: reg, capability_id: 'cap:sha256:test', handler: null }),
    (e) => e && e.code === 'INVALID_HANDLER'
  );
});

test('handler registry: unknown capability_id returns deterministic not-found result (null)', () => {
  const reg = createCapabilityHandlerRegistry();
  const got = getCapabilityHandler({ registry: reg, capability_id: 'cap:sha256:missing' });
  assert.equal(got, null);
});

test('handler registry: no task/mailbox/marketplace fields leak into registry behavior', () => {
  const reg = createCapabilityHandlerRegistry();
  // Registry is internal structure; ensure it does not expose task/mailbox/market fields.
  for (const k of Object.keys(reg)) {
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
    assert.ok(!k.includes('market'));
  }
});
