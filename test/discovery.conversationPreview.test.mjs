import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscoveryCandidate, DISCOVERY_SOURCES } from '../src/discovery/discoveryCandidate.mjs';
import { evaluateDiscoveryCompatibility } from '../src/discovery/discoveryCompatibility.mjs';
import {
  createDiscoveryConversationPreview,
  DISCOVERY_PREVIEW_SAFETY_NOTES
} from '../src/discovery/discoveryConversationPreview.mjs';

test('discovery conversation preview: valid candidate + compatibility produce preview', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });

  const compatibility = evaluateDiscoveryCompatibility({ candidate });

  const preview = createDiscoveryConversationPreview({ candidate, compatibility });

  assert.deepEqual(Object.keys(preview), [
    'preview_id',
    'discovery_candidate_id',
    'headline',
    'opening_line',
    'safety_notes'
  ]);

  assert.ok(preview.preview_id.startsWith('dprev:sha256:'));
  assert.equal(preview.discovery_candidate_id, candidate.discovery_candidate_id);
  assert.equal(preview.headline, 'Known peer available');
  assert.equal(preview.opening_line, 'Your agent can start a lightweight introduction.');
  assert.deepEqual(preview.safety_notes, [DISCOVERY_PREVIEW_SAFETY_NOTES.HUMAN_REVIEW_REQUIRED]);
});

test('discovery conversation preview: invalid input fails closed', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });

  assert.throws(
    () => createDiscoveryConversationPreview({ candidate: null, compatibility }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createDiscoveryConversationPreview({ candidate, compatibility: null }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () => createDiscoveryConversationPreview({
      candidate,
      compatibility: { ...compatibility, discovery_candidate_id: 'dcand:sha256:other' }
    }),
    (e) => e && e.code === 'MISMATCH'
  );
});

test('discovery conversation preview: deterministic output shape and values', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });

  const a = createDiscoveryConversationPreview({ candidate, compatibility });
  const b = createDiscoveryConversationPreview({ candidate, compatibility });

  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('discovery conversation preview: safety_notes allowlist enforced (output fixed)', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });

  const preview = createDiscoveryConversationPreview({ candidate, compatibility });
  assert.deepEqual(preview.safety_notes, [DISCOVERY_PREVIEW_SAFETY_NOTES.HUMAN_REVIEW_REQUIRED]);
});

test('discovery conversation preview: no capability/task/mailbox fields leak', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });

  const preview = createDiscoveryConversationPreview({ candidate, compatibility });

  for (const k of Object.keys(preview)) {
    assert.ok(!k.includes('capability'));
    assert.ok(!k.includes('task'));
    assert.ok(!k.includes('mailbox'));
  }
});

test('discovery conversation preview: headline/opening_line remain bounded strings', () => {
  const candidate = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer1',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const compatibility = evaluateDiscoveryCompatibility({ candidate });

  const preview = createDiscoveryConversationPreview({ candidate, compatibility });

  assert.equal(typeof preview.headline, 'string');
  assert.equal(typeof preview.opening_line, 'string');
  assert.ok(preview.headline.length > 0 && preview.headline.length <= 120);
  assert.ok(preview.opening_line.length > 0 && preview.opening_line.length <= 200);
});
