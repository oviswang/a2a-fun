import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanExperienceSummary } from '../src/experience/cleanExperienceSummary.mjs';

test('removes question artifacts and short lines', () => {
  const out = cleanExperienceSummary({
    what_worked: ['Question: blah blah blah blah blah', 'too short', 'This is long enough to keep.'],
    what_failed: ['Intent: xxxxxxxxxxxxxxxxxxxxxxxx', 'Another long enough failure line.'],
    tools_workflow: ['Conversation goal: xxxxxxxxxxxxxxxxxxxxxxx', 'Expected output: xxxxxxxxxxxxxxxxxxxxxxx'],
    next_step: []
  });
  assert.deepEqual(out.what_worked, ['This is long enough to keep.']);
  assert.deepEqual(out.what_failed, ['Another long enough failure line.']);
  assert.deepEqual(out.tools_workflow, []);
});

test('removes n/a variants (case-insensitive)', () => {
  const out = cleanExperienceSummary({
    what_worked: ['Workflow/tools used: n/a.', 'This is long enough to keep.'],
    what_failed: ['Not available right now, sorry this is long enough.'],
    tools_workflow: ['NONE of this should remain because it says none and is long enough'],
    next_step: []
  });
  assert.deepEqual(out.what_worked, ['This is long enough to keep.']);
  assert.deepEqual(out.what_failed, []);
  assert.deepEqual(out.tools_workflow, []);
});

test('deduplicates within fields with normalization', () => {
  const out = cleanExperienceSummary({
    what_worked: ['Keep exactly one inbound relay session.', ' keep   exactly one inbound   relay session. '],
    what_failed: [],
    tools_workflow: [],
    next_step: []
  });
  assert.deepEqual(out.what_worked, ['Keep exactly one inbound relay session.']);
});

test('removes duplicates across fields by priority', () => {
  const line = 'Alert when /nodes shows multiple sessions for the same node_id.';
  const out = cleanExperienceSummary({
    what_worked: [line],
    what_failed: [line],
    tools_workflow: [line],
    next_step: [line]
  });
  assert.deepEqual(out.tools_workflow, [line]);
  assert.deepEqual(out.what_worked, []);
  assert.deepEqual(out.what_failed, []);
  assert.deepEqual(out.next_step, []);
});

test('enforces list size limits', () => {
  const mk = (p, n) => Array.from({ length: n }, (_, i) => `${p} ${i} is long enough to keep for cleanup rules.`);
  const out = cleanExperienceSummary({
    what_worked: mk('worked', 10),
    what_failed: mk('failed', 10),
    tools_workflow: mk('tools', 10),
    next_step: mk('next', 10)
  });
  assert.equal(out.what_worked.length, 5);
  assert.equal(out.what_failed.length, 5);
  assert.equal(out.tools_workflow.length, 5);
  assert.equal(out.next_step.length, 3);
});
