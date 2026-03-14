import test from 'node:test';
import assert from 'node:assert/strict';

import { listCapabilities } from '../src/capability/capabilityDiscoveryList.mjs';
import { createHttpTransport } from '../src/runtime/transport/httpTransport.mjs';

test('capability discovery list: valid registry returns sorted capability list', () => {
  const out = listCapabilities({ registry: { z: () => {}, a: () => {}, m: () => {} } });
  assert.equal(out.ok, true);
  assert.deepEqual(out.capabilities, ['a', 'm', 'z']);
});

test('capability discovery list: invalid registry fails closed', () => {
  assert.equal(listCapabilities({ registry: null }).ok, false);
  assert.equal(listCapabilities({ registry: [] }).ok, false);
  assert.equal(listCapabilities({ registry: 'x' }).ok, false);
});

test('GET /capabilities returns machine-safe JSON with official capability ids (deterministic order)', async () => {
  const t = createHttpTransport();
  const srv = await t.startServer({
    port: 0,
    onMessage: async () => ({ ok: true })
  });

  try {
    const r = await fetch(`http://127.0.0.1:${srv.port}/capabilities`);
    assert.equal(r.status, 200);
    const j = await r.json();

    assert.equal(j.ok, true);
    assert.equal(j.node_id, null);

    // Must include official pack capability ids.
    assert.deepEqual(j.capabilities, ['echo', 'text_transform', 'translate']);

    // Deterministic ordering.
    assert.deepEqual([...j.capabilities].sort(), j.capabilities);
  } finally {
    await srv.close();
  }
});
