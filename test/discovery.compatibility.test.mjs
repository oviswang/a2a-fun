import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscoveryCandidate, DISCOVERY_SOURCES } from '../src/discovery/discoveryCandidate.mjs';
import {
  evaluateDiscoveryCompatibility,
  DISCOVERY_COMPATIBILITY_REASONS
} from '../src/discovery/discoveryCompatibility.mjs';

test('discovery compatibility: valid candidate produces machine-safe compatibility result', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });

  const out = evaluateDiscoveryCompatibility({ candidate });

  assert.deepEqual(Object.keys(out), ['discovery_candidate_id', 'score', 'reasons']);
  assert.equal(out.discovery_candidate_id, candidate.discovery_candidate_id);
  assert.equal(out.score, 1);
  assert.deepEqual(out.reasons, [DISCOVERY_COMPATIBILITY_REASONS.KNOWN_PEER_AVAILABLE]);
});

test('discovery compatibility: invalid candidate fails closed', () => {
  assert.throws(
    () => evaluateDiscoveryCompatibility({ candidate: null }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => evaluateDiscoveryCompatibility({ candidate: { discovery_candidate_id: 'x' } }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  // Unsupported source should fail closed.
  const bad = {
    discovery_candidate_id: 'dcand:sha256:x',
    peer_actor_id: 'h:sha256:p',
    peer_url: 'https://x',
    source: 'NOPE',
    created_at: new Date(0).toISOString()
  };

  assert.throws(
    () => evaluateDiscoveryCompatibility({ candidate: bad }),
    (e) => e && e.code === 'INVALID_CANDIDATE'
  );
});

test('discovery compatibility: deterministic output shape and values', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });

  const a = evaluateDiscoveryCompatibility({ candidate });
  const b = evaluateDiscoveryCompatibility({ candidate });

  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('discovery compatibility: reasons allowlist enforced (output is fixed allowlist)', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });

  const out = evaluateDiscoveryCompatibility({ candidate });
  assert.deepEqual(out.reasons, [DISCOVERY_COMPATIBILITY_REASONS.KNOWN_PEER_AVAILABLE]);
});

test('discovery compatibility: score remains bounded (0..100)', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });

  const out = evaluateDiscoveryCompatibility({ candidate });
  assert.ok(Number.isInteger(out.score));
  assert.ok(out.score >= 0 && out.score <= 100);
});

test('discovery compatibility: no capability/task/mailbox fields leak', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });

  const out = evaluateDiscoveryCompatibility({ candidate });

  for (const k of Object.keys(out)) {
    assert.ok(!k.includes('capability'));
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
  }
});
