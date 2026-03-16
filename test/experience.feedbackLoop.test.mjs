import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateExperienceFeedback } from '../src/experience/evaluateExperienceFeedback.mjs';

test('reinforcement detection', () => {
  const out = evaluateExperienceFeedback({
    topic: 'relay',
    injected_knowledge: { what_worked: ['keep one long-running inbound relay client'], what_failed: [], tools_workflow: [], next_step: [] },
    new_summary: { what_worked: [' keep   one long-running inbound relay client '], what_failed: [], tools_workflow: [], next_step: [] }
  });
  assert.equal(out.reinforced.length, 1);
  assert.equal(out.contradicted.length, 0);
});

test('contradiction detection', () => {
  const out = evaluateExperienceFeedback({
    topic: 'relay',
    injected_knowledge: { what_worked: ['reuse it for replies'], what_failed: ['session churn is the main culprit'], tools_workflow: [], next_step: [] },
    new_summary: { what_worked: ['session churn is the main culprit'], what_failed: [], tools_workflow: [], next_step: [] }
  });
  assert.equal(out.contradicted.length, 1);
});

test('new experience detection', () => {
  const out = evaluateExperienceFeedback({
    topic: 'relay',
    injected_knowledge: { what_worked: [], what_failed: [], tools_workflow: [], next_step: [] },
    new_summary: { what_worked: ['new technique that works well'], what_failed: [], tools_workflow: [], next_step: [] }
  });
  assert.equal(out.new_experience.length, 1);
});

test('normalization matching', () => {
  const out = evaluateExperienceFeedback({
    topic: 'relay',
    injected_knowledge: { what_worked: [], what_failed: ['avoid one-shot clients that can unregister/replace sessions'], tools_workflow: [], next_step: [] },
    new_summary: { what_worked: [], what_failed: [' avoid  one-shot clients that can unregister/replace sessions '], tools_workflow: [], next_step: [] }
  });
  assert.equal(out.reinforced.length, 1);
});
