import test from 'node:test';
import assert from 'node:assert/strict';

import { checkPeerRelayHealth } from '../src/social/checkPeerRelayHealth.mjs';

// Mock fetch for relay /nodes by patching globalThis.fetch in tests
function withMockFetch(fn) {
  const orig = globalThis.fetch;
  return (async () => {
    try {
      await fn();
    } finally {
      globalThis.fetch = orig;
    }
  })();
}

test('healthy peer -> allowed', async () => withMockFetch(async () => {
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/nodes')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, nodes: [{ node_id: 'p', session_id: 's1' }] }), json: async () => ({ ok: true, nodes: [{ node_id: 'p', session_id: 's1' }] }) };
    }
    throw new Error('unexpected');
  };
  const out = await checkPeerRelayHealth({ node_id: 'p', relay_local_http: 'http://relay' });
  assert.equal(out.relay_health, 'healthy');
  assert.equal(out.ok, true);
}));

test('degraded peer -> allowed with warning', async () => withMockFetch(async () => {
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/nodes')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, nodes: [{ node_id: 'p', session_id: 's1' }] }), json: async () => ({ ok: true, nodes: [{ node_id: 'p', session_id: 's1' }] }) };
    }
    throw new Error('unexpected');
  };
  const out = await checkPeerRelayHealth({ node_id: 'p', relay_local_http: 'http://relay', traces: [{ event: 'dropped_no_target', to: 'p' }] });
  assert.equal(out.relay_health, 'degraded');
  assert.equal(out.ok, true);
}));

test('unknown peer -> blocked', async () => withMockFetch(async () => {
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/nodes')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, nodes: [] }), json: async () => ({ ok: true, nodes: [] }) };
    }
    throw new Error('unexpected');
  };
  const out = await checkPeerRelayHealth({ node_id: 'p', relay_local_http: 'http://relay' });
  assert.equal(out.relay_health, 'unknown');
  assert.equal(out.ok, false);
}));

test('unhealthy peer -> blocked', async () => withMockFetch(async () => {
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/nodes')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, nodes: [{ node_id: 'p', session_id: 's1' }] }), json: async () => ({ ok: true, nodes: [{ node_id: 'p', session_id: 's1' }] }) };
    }
    throw new Error('unexpected');
  };
  const out = await checkPeerRelayHealth({ node_id: 'p', relay_local_http: 'http://relay', traces: [{ event: 'unregister', from: 'p' }, { event: 'unregister', from: 'p' }] });
  assert.equal(out.relay_health, 'unhealthy');
  assert.equal(out.ok, false);
}));
