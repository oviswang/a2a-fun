import test from 'node:test';
import assert from 'node:assert/strict';

import { validateExperienceDecisions } from '../src/experience/validateExperienceDecisions.mjs';

test('reinforcement detection', () => {
  const out = validateExperienceDecisions({
    decisions: ['keep one long-running inbound relay client'],
    new_summary: { what_worked: [' keep   one long-running inbound relay client '], what_failed: [] }
  });
  assert.equal(out.reinforced.length, 1);
  assert.equal(out.contradicted.length, 0);
  assert.equal(out.neutral.length, 0);
});

test('contradiction detection', () => {
  const out = validateExperienceDecisions({
    decisions: ['avoid one-shot clients that can unregister/replace sessions'],
    new_summary: { what_worked: [], what_failed: ['avoid one-shot clients that can unregister/replace sessions'] }
  });
  assert.equal(out.contradicted.length, 1);
});

test('neutral detection', () => {
  const out = validateExperienceDecisions({
    decisions: ['alert when /nodes shows multiple sessions for the same node_id'],
    new_summary: { what_worked: [], what_failed: [] }
  });
  assert.equal(out.neutral.length, 1);
});

test('normalization', () => {
  const out = validateExperienceDecisions({
    decisions: [' Alert when /nodes shows multiple sessions for the same node_id '],
    new_summary: { what_worked: ['alert   when /nodes shows multiple sessions for the same node_id'], what_failed: [] }
  });
  assert.equal(out.reinforced.length, 1);
});
