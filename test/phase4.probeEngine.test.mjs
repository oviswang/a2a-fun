import test from 'node:test';
import assert from 'node:assert/strict';

import {
  probeEngine,
  PROBE_ENGINE_COMPLETION_RULE,
  PROBE_ENGINE_QUESTION_1,
  PROBE_ENGINE_QUESTION_2,
  PROBE_ENGINE_SUMMARY_TEXT
} from '../src/phase4/probe/probeEngine.mjs';

function q(q) {
  return { type: 'probe.question', body: { q } };
}
function a(a) {
  return { type: 'probe.answer', body: { a } };
}
function s(summary) {
  return { type: 'probe.summary', body: { summary } };
}
function d() {
  return { type: 'probe.done', body: { done: true } };
}

test('phase4 probeEngine: non-PROBING state does not advance probe improperly', () => {
  const out = probeEngine.next({ state: { state: 'DISCONNECTED' }, transcript: [] });
  assert.equal(out, null);
});

test('phase4 probeEngine: empty transcript produces first probe.question (fixed)', () => {
  const out = probeEngine.next({ state: { state: 'PROBING' }, transcript: [] });
  assert.equal(out.type, 'probe.question');
  assert.equal(out.body.q, PROBE_ENGINE_QUESTION_1);
});

test('phase4 probeEngine: valid transcript produces next probe.question (fixed)', () => {
  const out = probeEngine.next({
    state: { state: 'PROBING' },
    transcript: [q(PROBE_ENGINE_QUESTION_1), a('A safe answer.')]
  });
  assert.equal(out.type, 'probe.question');
  assert.equal(out.body.q, PROBE_ENGINE_QUESTION_2);
});

test('phase4 probeEngine: completion condition produces probe.summary', () => {
  assert.equal(PROBE_ENGINE_COMPLETION_RULE.completion_rounds, 2);

  const out = probeEngine.next({
    state: { state: 'PROBING' },
    transcript: [
      q(PROBE_ENGINE_QUESTION_1),
      a('A safe answer.'),
      q(PROBE_ENGINE_QUESTION_2),
      a('Another safe answer.')
    ]
  });
  assert.equal(out.type, 'probe.summary');
  assert.equal(out.body.summary, PROBE_ENGINE_SUMMARY_TEXT);
});

test('phase4 probeEngine: after summary, engine produces probe.done', () => {
  const out = probeEngine.next({
    state: { state: 'PROBING' },
    transcript: [
      q(PROBE_ENGINE_QUESTION_1),
      a('A safe answer.'),
      q(PROBE_ENGINE_QUESTION_2),
      a('Another safe answer.'),
      s(PROBE_ENGINE_SUMMARY_TEXT)
    ]
  });
  assert.equal(out.type, 'probe.done');
  assert.deepEqual(out.body, { done: true });
});

test('phase4 probeEngine: invalid transcript shape throws', () => {
  assert.throws(
    () => probeEngine.next({ state: { state: 'PROBING' }, transcript: [{}] }),
    /type must be string|body missing/
  );
});

test('phase4 probeEngine: unsupported sequence throws (dangling question)', () => {
  assert.throws(
    () => probeEngine.next({ state: { state: 'PROBING' }, transcript: [q(PROBE_ENGINE_QUESTION_1)] }),
    /dangling probe\.question/
  );
});

test('phase4 probeEngine: behavior is deterministic for the same input', () => {
  const input = {
    state: { state: 'PROBING' },
    transcript: [q(PROBE_ENGINE_QUESTION_1), a('A safe answer.')]
  };
  const out1 = probeEngine.next(input);
  const out2 = probeEngine.next(input);
  assert.deepEqual(out1, out2);
});

// Additional sequence guard: done before summary

test('phase4 probeEngine: unsupported sequence throws (done before summary)', () => {
  assert.throws(
    () => probeEngine.next({ state: { state: 'PROBING' }, transcript: [d()] }),
    /before probe\.summary/
  );
});

test('phase4 probeEngine: fail closed (summary then summary) throws', () => {
  assert.throws(
    () =>
      probeEngine.next({
        state: { state: 'PROBING' },
        transcript: [
          q(PROBE_ENGINE_QUESTION_1),
          a('A safe answer.'),
          q(PROBE_ENGINE_QUESTION_2),
          a('Another safe answer.'),
          s(PROBE_ENGINE_SUMMARY_TEXT),
          s(PROBE_ENGINE_SUMMARY_TEXT)
        ]
      }),
    /duplicate probe\.summary/
  );
});
