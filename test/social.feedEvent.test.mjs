import test from 'node:test';
import assert from 'node:assert/strict';

import { createSocialFeedEvent } from '../src/social/socialFeedEvent.mjs';

test('social feed event: deterministic machine-safe shape for discovered_agent', () => {
  const out = createSocialFeedEvent({
    event_type: 'discovered_agent',
    created_at: '2026-03-14T00:00:00.000Z',
    agent_id: 'nodeA',
    peer_agent_id: 'nodeB',
    summary: 'OpenClaw deployment'
  });
  assert.equal(out.ok, true);
  assert.deepEqual(Object.keys(out.event), ['event_type', 'created_at', 'agent_id', 'peer_agent_id', 'summary', 'details']);
});

test('social feed event: invalid type fails closed', () => {
  const out = createSocialFeedEvent({ event_type: 'x', created_at: 't', summary: 's' });
  assert.equal(out.ok, false);
});
