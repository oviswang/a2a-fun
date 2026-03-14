import test from 'node:test';
import assert from 'node:assert/strict';

import { createRemoteHumanJoinSignal, validateRemoteHumanJoinSignal } from '../src/social/remoteHumanJoinSignal.mjs';

test('remote human join signal: valid signal can be created and validated', () => {
  const out = createRemoteHumanJoinSignal({
    handoff_id: 'h1',
    from_agent_id: 'nodeA',
    to_agent_id: 'nodeB',
    created_at: '2026-03-14T00:00:00.000Z'
  });
  assert.equal(out.ok, true);
  assert.equal(out.signal.kind, 'REMOTE_HUMAN_JOIN_SIGNAL');

  const v = validateRemoteHumanJoinSignal(out.signal);
  assert.equal(v.ok, true);
});

test('remote human join signal: invalid signal fails closed', () => {
  assert.equal(createRemoteHumanJoinSignal({}).ok, false);
  assert.equal(validateRemoteHumanJoinSignal({ kind: 'x' }).ok, false);
});
