import test from 'node:test';
import assert from 'node:assert/strict';

import { stripExperiencePrefixes } from '../src/experience/stripExperiencePrefixes.mjs';

test('exact prefix with colon', () => {
  const out = stripExperiencePrefixes({
    what_worked: [],
    what_failed: ['Re your difficulty: session churn is the main culprit'],
    tools_workflow: [],
    next_step: []
  });
  assert.deepEqual(out.what_failed, ['session churn is the main culprit']);
});

test('prefix without colon', () => {
  const out = stripExperiencePrefixes({
    what_worked: [],
    what_failed: ['In practice session churn is the main culprit'],
    tools_workflow: [],
    next_step: []
  });
  assert.deepEqual(out.what_failed, ['session churn is the main culprit']);
});

test('non-prefix text unchanged (except trim)', () => {
  const out = stripExperiencePrefixes({
    what_worked: [' keep one long-running inbound relay client '],
    what_failed: [],
    tools_workflow: [],
    next_step: []
  });
  assert.deepEqual(out.what_worked, ['keep one long-running inbound relay client']);
});

test('too-short remainder dropped', () => {
  const out = stripExperiencePrefixes({
    what_worked: [],
    what_failed: ['I think: ok'],
    tools_workflow: [],
    next_step: []
  });
  assert.deepEqual(out.what_failed, []);
});

test('relay topic examples', () => {
  const out = stripExperiencePrefixes({
    what_worked: [],
    what_failed: ['Re your difficulty: session churn is the main culprit'],
    tools_workflow: [],
    next_step: ['If I had to pick one safeguard: alert when /nodes shows multiple sessions for the same node_id']
  });
  assert.deepEqual(out.what_failed, ['session churn is the main culprit']);
  assert.deepEqual(out.next_step, ['alert when /nodes shows multiple sessions for the same node_id']);
});
