import test from 'node:test';
import assert from 'node:assert/strict';

import { filterExperienceFragments } from '../src/experience/filterExperienceFragments.mjs';

test('framing fragment removed', () => {
  const out = filterExperienceFragments({
    what_worked: [],
    what_failed: ['Re your difficulty:'],
    tools_workflow: [],
    next_step: ['If I had to pick one safeguard']
  });
  assert.deepEqual(out.what_failed, []);
  assert.deepEqual(out.next_step, []);
});

test('concrete technical fragment kept', () => {
  const out = filterExperienceFragments({
    what_worked: [],
    what_failed: [],
    tools_workflow: ['fast loop of /nodes + /traces checks after each change'],
    next_step: []
  });
  assert.deepEqual(out.tools_workflow, ['fast loop of /nodes + /traces checks after each change']);
});

test('action-oriented next step kept', () => {
  const out = filterExperienceFragments({
    what_worked: [],
    what_failed: [],
    tools_workflow: [],
    next_step: ['alert when /nodes shows multiple sessions for the same node_id']
  });
  assert.deepEqual(out.next_step, ['alert when /nodes shows multiple sessions for the same node_id']);
});

test('mixed list filtered correctly', () => {
  const out = filterExperienceFragments({
    what_worked: ['keep one long-running inbound relay client'],
    what_failed: ['On your question:'],
    tools_workflow: ['Workflow/tools used'],
    next_step: ['If I had to pick one safeguard', 'monitor relay sessions']
  });
  assert.deepEqual(out.what_worked, ['keep one long-running inbound relay client']);
  assert.deepEqual(out.what_failed, []);
  assert.deepEqual(out.tools_workflow, []);
  assert.deepEqual(out.next_step, ['monitor relay sessions']);
});
