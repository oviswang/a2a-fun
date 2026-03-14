import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscoveryCandidate, DISCOVERY_SOURCES } from '../src/discovery/discoveryCandidate.mjs';

test('discovery candidate: valid input produces machine-safe discovery candidate', () => {
  const c = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });

  assert.deepEqual(Object.keys(c), [
    'discovery_candidate_id',
    'peer_actor_id',
    'peer_url',
    'source',
    'created_at'
  ]);

  assert.ok(c.discovery_candidate_id.startsWith('dcand:sha256:'));
  assert.equal(c.peer_actor_id, 'h:sha256:peer1');
  assert.equal(c.peer_url, 'https://example.com/a2a');
  assert.equal(c.source, 'KNOWN_PEERS');
  assert.equal(c.created_at, new Date(0).toISOString());
});

test('discovery candidate: invalid input fails closed', () => {
  assert.throws(
    () => createDiscoveryCandidate(null),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createDiscoveryCandidate({ peer_actor_id: '', peer_url: 'x', source: 'KNOWN_PEERS' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createDiscoveryCandidate({ peer_actor_id: 'h:sha256:peer1', peer_url: '', source: 'KNOWN_PEERS' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createDiscoveryCandidate({ peer_actor_id: 'h:sha256:peer1', peer_url: 'x', source: '' }),
    (e) => e && e.code === 'INVALID_INPUT'
  );
});

test('discovery candidate: deterministic output shape and values', () => {
  const a = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const b = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });

  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('discovery candidate: source allowlist enforced', () => {
  assert.throws(
    () => createDiscoveryCandidate({ peer_actor_id: 'h:sha256:peer1', peer_url: 'https://x', source: 'NOPE' }),
    (e) => e && e.code === 'INVALID_SOURCE'
  );
});

test('discovery candidate: no capability/task/mailbox fields leak', () => {
  const c = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });

  for (const k of Object.keys(c)) {
    assert.ok(!k.includes('capability'));
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
  }
});
