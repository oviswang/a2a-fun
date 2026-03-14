import test from 'node:test';
import assert from 'node:assert/strict';

import { createSocialFeedEvent } from '../src/social/socialFeedEvent.mjs';
import { formatSocialFeedMessage } from '../src/social/socialFeedFormatter.mjs';

test('social feed formatter: produces readable text for invocation_received', () => {
  const ev = createSocialFeedEvent({
    event_type: 'invocation_received',
    created_at: '2026-03-14T00:00:00.000Z',
    agent_id: 'nodeA',
    peer_agent_id: 'nodeB',
    summary: 'request arrived',
    details: { capability_id: 'translate' }
  });
  assert.equal(ev.ok, true);

  const out = formatSocialFeedMessage({ event: ev.event });
  assert.equal(out.ok, true);
  assert.match(out.message, /New request received from nodeB/);
  assert.match(out.message, /Capability: translate/);
});
