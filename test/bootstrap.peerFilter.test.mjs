import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createBootstrapServer } from '../src/bootstrap/bootstrapServer.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-bootstrap-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('bootstrap /peers returns protocol envelope + only active peers', async () => {
  await withTempDir(async (dir) => {
    const registryFile = path.join(dir, 'bootstrap-registry.json');
    // Seed a registry containing one active node and one expired node.
    const now = Date.now();
    const activeLastSeen = new Date(now).toISOString();
    const expiredLastSeen = new Date(now - 60 * 60 * 1000).toISOString();

    await fs.writeFile(
      registryFile,
      JSON.stringify(
        {
          ok: true,
          version: 'registry.v0.1',
          updated_at: activeLastSeen,
          nodes: {
            'node-active': {
              node_id: 'node-active',
              last_seen: activeLastSeen,
              relay_urls: ['wss://relay.example/relay'],
              observed_addrs: [],
              capabilities: { requires: ['run_check'] }
            },
            'node-expired': {
              node_id: 'node-expired',
              last_seen: expiredLastSeen,
              relay_urls: ['wss://relay.example/relay'],
              observed_addrs: [],
              capabilities: { requires: ['run_check'] }
            }
          }
        },
        null,
        2
      ),
      'utf8'
    );

    const srv = createBootstrapServer({ bindHost: '127.0.0.1', port: 0, registryFile });
    await srv.start();
    const addr = srv.address();
    assert.ok(addr && typeof addr.port === 'number');

    const base = `http://127.0.0.1:${addr.port}`;
    const res = await fetch(`${base}/peers`);
    assert.equal(res.status, 200);
    const j = await res.json();

    assert.equal(j.ok, true);
    assert.equal(j.protocol, 'a2a/0.1');
    assert.ok(Array.isArray(j.peers));
    assert.ok(j.peers.find((p) => p.node_id === 'node-active'));
    assert.ok(!j.peers.find((p) => p.node_id === 'node-expired'));

    await srv.close();
  });
});

test('bootstrap returns 404 for removed endpoints (join)', async () => {
  await withTempDir(async (dir) => {
    const registryFile = path.join(dir, 'bootstrap-registry.json');
    const srv = createBootstrapServer({ bindHost: '127.0.0.1', port: 0, registryFile });
    await srv.start();
    const addr = srv.address();
    const base = `http://127.0.0.1:${addr.port}`;

    const res = await fetch(`${base}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ node: 'http://127.0.0.1:3000/' })
    });

    assert.equal(res.status, 404);
    const j = await res.json();
    assert.equal(j.ok, false);
    assert.equal(j.error.code, 'NOT_FOUND');

    await srv.close();
  });
});
