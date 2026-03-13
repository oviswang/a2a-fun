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

test('bootstrap /peers filters localhost + 127.0.0.1 + example.com placeholders', async () => {
  await withTempDir(async (dir) => {
    const dataFile = path.join(dir, 'bootstrap-peers.json');
    await fs.writeFile(
      dataFile,
      JSON.stringify(
        {
          peers: [
            'http://127.0.0.1:3000/',
            'http://localhost:3000/',
            'https://node.example.com/',
            'https://node2.example.com/',
            'https://good.peer.example.net/'
          ]
        },
        null,
        2
      ),
      'utf8'
    );

    const srv = createBootstrapServer({ bindHost: '127.0.0.1', port: 0, dataFile });
    await srv.start();
    const addr = srv.address();
    assert.ok(addr && typeof addr.port === 'number');

    const base = `http://127.0.0.1:${addr.port}`;
    const res = await fetch(`${base}/peers`);
    assert.equal(res.status, 200);
    const j = await res.json();

    assert.deepEqual(j, { ok: true, peers: ['https://good.peer.example.net/'] });

    await srv.close();
  });
});

test('bootstrap /join rejects unusable node URLs (localhost / placeholders)', async () => {
  await withTempDir(async (dir) => {
    const dataFile = path.join(dir, 'bootstrap-peers.json');

    const srv = createBootstrapServer({ bindHost: '127.0.0.1', port: 0, dataFile });
    await srv.start();
    const addr = srv.address();
    const base = `http://127.0.0.1:${addr.port}`;

    const res = await fetch(`${base}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ node: 'http://127.0.0.1:3000/' })
    });

    assert.equal(res.status, 400);
    const j = await res.json();
    assert.deepEqual(j, { ok: false, error: { code: 'UNUSABLE_NODE', reason: 'unusable node url' } });

    await srv.close();
  });
});
