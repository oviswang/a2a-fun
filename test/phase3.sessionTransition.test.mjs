import test from 'node:test';
import assert from 'node:assert/strict';

import { SESSION_PROBE_KINDS_PHASE3 } from '../src/phase3/session/sessionProbeKinds.mjs';
import { applySessionProbeMessage, SESSION_STATES_PHASE3 } from '../src/phase3/session/sessionStateTransition.mjs';

function baseState(overrides = {}) {
  return {
    session_id: null,
    peer_actor_id: null,
    state: SESSION_STATES_PHASE3.NEW,
    local_entered: false,
    remote_entered: false,
    ...overrides
  };
}

test('Phase3 session transition: SESSION_PROBE_INIT moves NEW -> LOCAL_ENTERED', () => {
  const next = applySessionProbeMessage({
    state: baseState(),
    message: { kind: SESSION_PROBE_KINDS_PHASE3.SESSION_PROBE_INIT, session_id: 's1', peer_actor_id: 'h:sha256:peer' }
  });

  assert.deepEqual(next, {
    session_id: 's1',
    peer_actor_id: 'h:sha256:peer',
    state: SESSION_STATES_PHASE3.LOCAL_ENTERED,
    local_entered: true,
    remote_entered: false
  });
});

test('Phase3 session transition: SESSION_PROBE_ACK moves forward to PROBING with remote_entered=true', () => {
  const init = applySessionProbeMessage({
    state: baseState(),
    message: { kind: SESSION_PROBE_KINDS_PHASE3.SESSION_PROBE_INIT, session_id: 's1', peer_actor_id: 'h:sha256:peer' }
  });

  const next = applySessionProbeMessage({
    state: init,
    message: { kind: SESSION_PROBE_KINDS_PHASE3.SESSION_PROBE_ACK, session_id: 's1', peer_actor_id: 'h:sha256:peer' }
  });

  assert.deepEqual(next, {
    session_id: 's1',
    peer_actor_id: 'h:sha256:peer',
    state: SESSION_STATES_PHASE3.PROBING,
    local_entered: true,
    remote_entered: true
  });
});

test('Phase3 session transition: unknown message kind fails closed', () => {
  assert.throws(
    () =>
      applySessionProbeMessage({
        state: baseState(),
        message: { kind: 'NOPE', session_id: 's1', peer_actor_id: 'h:sha256:peer' }
      }),
    (e) => e && e.code === 'UNKNOWN_KIND'
  );
});

test('Phase3 session transition: missing required fields fails closed', () => {
  assert.throws(
    () =>
      applySessionProbeMessage({
        state: baseState(),
        message: { kind: SESSION_PROBE_KINDS_PHASE3.SESSION_PROBE_INIT, session_id: '', peer_actor_id: 'h:sha256:peer' }
      }),
    (e) => e && e.code === 'INVALID_INPUT'
  );

  assert.throws(
    () =>
      applySessionProbeMessage({
        state: baseState(),
        message: { kind: SESSION_PROBE_KINDS_PHASE3.SESSION_PROBE_INIT, session_id: 's1', peer_actor_id: '' }
      }),
    (e) => e && e.code === 'INVALID_INPUT'
  );
});

test('Phase3 session transition: deterministic machine-safe output shape', () => {
  const a = applySessionProbeMessage({
    state: baseState(),
    message: { kind: SESSION_PROBE_KINDS_PHASE3.SESSION_PROBE_INIT, session_id: 's1', peer_actor_id: 'h:sha256:peer' }
  });

  const b = applySessionProbeMessage({
    state: baseState(),
    message: { kind: SESSION_PROBE_KINDS_PHASE3.SESSION_PROBE_INIT, session_id: 's1', peer_actor_id: 'h:sha256:peer' }
  });

  assert.deepEqual(Object.keys(a), ['session_id', 'peer_actor_id', 'state', 'local_entered', 'remote_entered']);
  assert.deepEqual(Object.keys(a), Object.keys(b));
  assert.equal(JSON.stringify(a), JSON.stringify(b));

  // Machine-safe guarantee: no raw envelope, no decrypted body, no arbitrary fields.
  assert.deepEqual(Object.keys(a), ['session_id', 'peer_actor_id', 'state', 'local_entered', 'remote_entered']);
});
