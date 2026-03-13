import test from 'node:test';
import assert from 'node:assert/strict';

import { applySessionMessage, applyLocalEvent } from '../src/phase2/session/session.manager.mjs';
import {
  ALLOWED_TRANSITIONS_PHASE2,
  CLOSE_REASONS_PHASE2,
  ALLOWED_LOCAL_EVENTS_PHASE2,
  LOCAL_EVENT_TYPES_PHASE2
} from '../src/phase2/config/phase2.constants.mjs';

function baseState(overrides = {}) {
  return {
    session_id: 's1',
    peer_actor_id: 'h:sha256:peer',
    state: 'DISCONNECTED',
    local_entered: false,
    remote_entered: false,
    probe_rounds_used: 0,
    probe_transcript_hash: null,
    closed_reason: null,
    ...overrides
  };
}

function env(type, msg_id = 'm1') {
  return { type, msg_id, session_id: 's1' };
}

test('legal transitions: DISCONNECTED + probe.hello -> PROBING', () => {
  const r = applySessionMessage({ state: baseState({ state: 'DISCONNECTED' }), verifiedEnvelope: env('probe.hello'), decryptedBody: { protocols: ['a2a.friendship/1'] } });
  assert.equal(r.next_state.state, 'PROBING');
  assert.deepEqual(r.session_patch, { state: 'PROBING' });
  assert.equal(r.audit_events.length, 1);
});

test('legal transitions: PROBING + probe.summary -> PROBE_COMPLETE', () => {
  const r = applySessionMessage({ state: baseState({ state: 'PROBING' }), verifiedEnvelope: env('probe.summary'), decryptedBody: { summary: 'Short safe summary.' } });
  assert.equal(r.next_state.state, 'PROBE_COMPLETE');
});

test('legal transitions: PROBE_COMPLETE + human.entry -> AWAIT_ENTRY (remote_entered=true)', () => {
  const r = applySessionMessage({
    state: baseState({ state: 'PROBE_COMPLETE', local_entered: false, remote_entered: false }),
    verifiedEnvelope: env('human.entry'),
    decryptedBody: { entered: true, bind: { session_id: 's1', probe_transcript_hash: 'h' } }
  });
  assert.equal(r.next_state.state, 'AWAIT_ENTRY');
  assert.equal(r.next_state.remote_entered, true);
  assert.deepEqual(r.session_patch, { state: 'AWAIT_ENTRY', remote_entered: true });
  assert.deepEqual(r.audit_events[0].flags_delta, { remote_entered: true });
});

test('human.entry under AWAIT_ENTRY is idempotent when remote_entered already true', () => {
  const r = applySessionMessage({
    state: baseState({ state: 'AWAIT_ENTRY', local_entered: false, remote_entered: true }),
    verifiedEnvelope: env('human.entry', 'm2'),
    decryptedBody: { entered: true, bind: { session_id: 's1', probe_transcript_hash: 'h' } }
  });
  assert.equal(r.next_state.state, 'AWAIT_ENTRY');
  assert.deepEqual(r.session_patch, { state: 'AWAIT_ENTRY' });
  assert.deepEqual(r.audit_events[0].flags_delta, {});
});

test('human.entry completes mutual entry when local_entered already true', () => {
  const r = applySessionMessage({
    state: baseState({ state: 'AWAIT_ENTRY', local_entered: true, remote_entered: false }),
    verifiedEnvelope: env('human.entry', 'm3'),
    decryptedBody: { entered: true, bind: { session_id: 's1', probe_transcript_hash: 'h' } }
  });
  assert.equal(r.next_state.state, 'MUTUAL_ENTRY_CONFIRMED');
  assert.deepEqual(r.session_patch, { state: 'MUTUAL_ENTRY_CONFIRMED', remote_entered: true });
});

test('session.close uses machine-safe allowlist for closed_reason', () => {
  const reason = CLOSE_REASONS_PHASE2[0];
  const r = applySessionMessage({
    state: baseState({ state: 'PROBING' }),
    verifiedEnvelope: env('session.close', 'm4'),
    decryptedBody: { reason, final: true }
  });
  assert.equal(r.next_state.state, 'CLOSED');
  assert.equal(r.session_patch.closed_reason, reason);

  assert.throws(
    () => applySessionMessage({ state: baseState({ state: 'PROBING' }), verifiedEnvelope: env('session.close', 'm5'), decryptedBody: { reason: 'free text', final: true } }),
    /closed_reason invalid/
  );
});

test('error: state unchanged but must emit audit_event', () => {
  const st = baseState({ state: 'PROBING' });
  const r = applySessionMessage({ state: st, verifiedEnvelope: env('error', 'm6'), decryptedBody: { code: 'INTERNAL', reason: 'UNKNOWN' } });
  assert.equal(r.next_state.state, 'PROBING');
  assert.equal(r.audit_events.length, 1);
  assert.equal(r.audit_events[0].kind, 'SESSION_ERROR');
});

test('illegal combos fail closed', () => {
  // wrong state for probe.hello
  assert.throws(
    () => applySessionMessage({ state: baseState({ state: 'PROBING' }), verifiedEnvelope: env('probe.hello'), decryptedBody: { protocols: ['a2a.friendship/1'] } }),
    /illegal transition/
  );

  // terminal state rejects everything
  assert.throws(
    () => applySessionMessage({ state: baseState({ state: 'CLOSED' }), verifiedEnvelope: env('probe.question'), decryptedBody: { q: 'hi' } }),
    /terminal/
  );
});

test('transition matrix matches ALLOWED_TRANSITIONS contract (allowlist passes, others fail closed)', () => {
  const ALLOWED_TRANSITIONS = ALLOWED_TRANSITIONS_PHASE2;

  const ALL_TYPES = [
    'probe.hello',
    'probe.question',
    'probe.answer',
    'probe.summary',
    'probe.done',
    'human.entry',
    'session.close',
    'error'
  ];

  const bodyFor = (type) => {
    if (type === 'probe.hello') return { protocols: ['a2a.friendship/1'] };
    if (type === 'probe.question') return { q: 'A safe question?' };
    if (type === 'probe.answer') return { a: 'A safe answer.' };
    if (type === 'probe.summary') return { summary: 'Short safe summary.' };
    if (type === 'probe.done') return { done: true };
    if (type === 'human.entry') return { entered: true, bind: { session_id: 's1', probe_transcript_hash: 'h' } };
    if (type === 'session.close') return { reason: CLOSE_REASONS_PHASE2[0], final: true };
    if (type === 'error') return { code: 'INTERNAL', reason: 'UNKNOWN' };
    throw new Error('missing body fixture');
  };

  for (const [st, allowed] of Object.entries(ALLOWED_TRANSITIONS)) {
    for (const t of ALL_TYPES) {
      const shouldAllow = allowed.includes(t);
      const fn = () => applySessionMessage({
        state: baseState({ state: st }),
        verifiedEnvelope: env(t, `m-${st}-${t}`),
        decryptedBody: bodyFor(t)
      });

      if (shouldAllow) {
        assert.doesNotThrow(fn, `expected allowed: ${st} + ${t}`);
      } else {
        assert.throws(fn, /illegal transition|terminal|unsupported transition|unknown\/invalid/, `expected reject: ${st} + ${t}`);
      }
    }
  }
});

test('local event matrix matches ALLOWED_LOCAL_EVENTS_PHASE2 (allowlist passes, others fail closed)', () => {
  const ALL_STATES = Object.keys(ALLOWED_LOCAL_EVENTS_PHASE2);

  const localEventFor = (type) => {
    if (type === 'local.human.entry') return { type, event_id: 'e1', probe_transcript_hash: 'h' };
    if (type === 'local.session.close') return { type, event_id: 'e2', reason: CLOSE_REASONS_PHASE2[0] };
    throw new Error('missing local event fixture');
  };

  for (const st of ALL_STATES) {
    const allowed = ALLOWED_LOCAL_EVENTS_PHASE2[st];
    for (const t of LOCAL_EVENT_TYPES_PHASE2) {
      const shouldAllow = allowed.includes(t);
      const fn = () => applyLocalEvent({
        state: baseState({ state: st }),
        localEvent: localEventFor(t)
      });

      if (shouldAllow) {
        assert.doesNotThrow(fn, `expected allowed local: ${st} + ${t}`);
      } else {
        assert.throws(fn, /illegal local event|terminal|unknown\/invalid|unsupported local event/, `expected reject local: ${st} + ${t}`);
      }
    }
  }
});

test('local.human.entry idempotent: already local_entered=true keeps flags_delta empty but emits LOCAL_EVENT audit', () => {
  const r = applyLocalEvent({
    state: baseState({ state: 'AWAIT_ENTRY', local_entered: true, remote_entered: false }),
    localEvent: { type: 'local.human.entry', event_id: 'e3', probe_transcript_hash: 'h' }
  });
  assert.equal(r.next_state.state, 'AWAIT_ENTRY');
  assert.deepEqual(r.audit_events[0].flags_delta, {});
  assert.equal(r.audit_events[0].kind, 'LOCAL_EVENT');
});
