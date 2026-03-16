import test from 'node:test';
import assert from 'node:assert/strict';

import { computeFingerprint, computeResultHash, shouldSkipExecution, handleDuplicateResult } from '../src/tasks/taskDedup.mjs';

function mkTask() {
  return { task_id: 'task:1', type: 'fetch', input: { url: 'https://example.com', max_chars: 10 }, status: 'completed', fingerprint: null };
}

test('fingerprint deterministic', () => {
  const a = mkTask();
  const b = mkTask();
  // different input key order should be same
  b.input = { max_chars: 10, url: 'https://example.com' };
  assert.equal(computeFingerprint(a), computeFingerprint(b));
});

test('execution guard skips completed with matching fingerprint', () => {
  const t = mkTask();
  t.fingerprint = computeFingerprint(t);
  const out = shouldSkipExecution({ task: t });
  assert.equal(out.skip, true);
});

test('duplicate result ignored if hashes match', () => {
  const local = { status: 'completed', result_hash: computeResultHash({ ok: true, x: 1 }) };
  const out = handleDuplicateResult({ localTask: local, incomingResult: { ok: true, x: 1 } });
  assert.equal(out.action, 'ignore');
});

test('duplicate result conflict if hashes differ', () => {
  const local = { status: 'completed', result_hash: computeResultHash({ ok: true, x: 1 }) };
  const out = handleDuplicateResult({ localTask: local, incomingResult: { ok: true, x: 2 } });
  assert.equal(out.action, 'conflict');
});
