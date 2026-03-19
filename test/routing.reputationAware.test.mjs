import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { emitReputationEvent } from '../src/reputation/reputation.mjs';
import { selectCandidateReputationAware } from '../src/routing/reputationAwareRouting.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-route-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function makeRng(seed = 1) {
  // deterministic LCG
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

test('routing: higher-reputation selected more often, low-rep still occasionally selected (exploration)', async () => {
  await withTempDir(async (dataDir) => {
    const sidHigh = 'sid-high111';
    const sidLow = 'sid-low222';

    // Create reputation: high hits +5 cap, low can reach -10 (negative not capped)
    for (let i = 0; i < 5; i++) emitReputationEvent({ super_identity_id: sidHigh, event_type: 'task_success', source: { type: 'system' } }, { dataDir });
    for (let i = 0; i < 10; i++) emitReputationEvent({ super_identity_id: sidLow, event_type: 'task_failure', source: { type: 'system' } }, { dataDir });

    const candidates = [
      { agent_id: 'agent-high', super_identity_id: sidHigh, name: 'A', skills: ['run_check'], last_seen: new Date().toISOString(), relationship_state: 'introduced' },
      { agent_id: 'agent-low', super_identity_id: sidLow, name: 'B', skills: ['run_check'], last_seen: new Date().toISOString(), relationship_state: 'introduced' }
    ];

    const rng = makeRng(42);

    let hi = 0;
    let lo = 0;
    for (let i = 0; i < 200; i++) {
      const out = selectCandidateReputationAware({
        candidates,
        topics: ['run_check'],
        explorationRate: 0.2,
        rng,
        dataDir
      });
      assert.equal(out.ok, true);
      if (out.selected.agent_id === 'agent-high') hi++;
      if (out.selected.agent_id === 'agent-low') lo++;
    }

    // High should be favored.
    assert.ok(hi > lo);
    // Low must still get some traffic (anti-centralization).
    assert.ok(lo > 0);
  });
});

test('routing: missing reputation data does not break routing', () => {
  const out = selectCandidateReputationAware({
    candidates: [{ agent_id: 'a1', name: 'X' }, { agent_id: 'a2', name: 'Y' }],
    topics: ['x'],
    explorationRate: 0.15,
    rng: makeRng(7)
  });
  assert.equal(out.ok, true);
  assert.ok(out.selected.agent_id);
});
