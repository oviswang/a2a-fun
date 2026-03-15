import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Validates: if directory listing fails, script still completes ok:true (does not exit 1).

test('refresh_agentcards falls back when directory unavailable', () => {
  const r = spawnSync('node', ['scripts/refresh_agentcards.mjs', '--baseUrl', 'http://127.0.0.1:1'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, A2A_WORKSPACE_PATH: process.cwd(), A2A_LOCAL_BASE_URL: 'http://127.0.0.1:3000' },
    encoding: 'utf8'
  });

  // Must not hard-fail on list failure
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('DIRECTORY_UNAVAILABLE_FALLBACK'));
});
