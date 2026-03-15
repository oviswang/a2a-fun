import test from 'node:test';
import assert from 'node:assert/strict';

import { createHttpTransport } from '../src/runtime/transport/httpTransport.mjs';
import { introspectLocalCapabilities } from '../src/discovery/agentCapabilityIntrospector.mjs';

test('introspectLocalCapabilities: fetches /capabilities and returns normalized strings', async () => {
  const t = createHttpTransport();
  const srv = await t.startServer({ port: 0, onMessage: async () => ({ ok: true }) });
  const base_url = `http://127.0.0.1:${srv.port}`;

  const out = await introspectLocalCapabilities({ base_url });
  await srv.close();

  assert.equal(out.ok, true);
  assert.equal(Array.isArray(out.capabilities), true);
  assert.equal(out.capabilities.length > 0, true);
  // Should contain something with "translate" in the official capability set.
  assert.equal(out.capabilities.some((s) => typeof s === 'string' && s.includes('translate')), true);
});

test('introspectLocalCapabilities: fail closed when unreachable', async () => {
  const out = await introspectLocalCapabilities({ base_url: 'http://127.0.0.1:1' });
  assert.equal(out.ok, false);
  assert.equal(Array.isArray(out.capabilities), true);
});
