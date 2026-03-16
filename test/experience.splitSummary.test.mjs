import test from 'node:test';
import assert from 'node:assert/strict';

import { splitExperienceSummary } from '../src/experience/splitExperienceSummary.mjs';

test('em dash splitting', () => {
  const s = {
    what_worked: [],
    what_failed: ['session churn is the main culprit — keep one long-running inbound relay client and reuse it for replies'],
    tools_workflow: [],
    next_step: []
  };
  const out = splitExperienceSummary(s);
  // splitting may further split on "and" when it joins separate actions
  assert.deepEqual(out.what_failed, [
    'session churn is the main culprit',
    'keep one long-running inbound relay client',
    'reuse it for replies'
  ]);
});

test('semicolon splitting', () => {
  const s = {
    what_worked: [],
    what_failed: ['avoid one-shot clients; they can unregister/replace sessions and cause drops'],
    tools_workflow: [],
    next_step: []
  };
  const out = splitExperienceSummary(s);
  assert.equal(out.what_failed.length, 2);
  assert.equal(out.what_failed[0], 'avoid one-shot clients');
});

test('mixed sentence preserved when split would be too weak', () => {
  const s = {
    what_worked: [],
    what_failed: ['ok — short'],
    tools_workflow: [],
    next_step: []
  };
  const out = splitExperienceSummary(s);
  // both fragments would be <15, so drop all
  assert.deepEqual(out.what_failed, []);
});

test('short fragments dropped', () => {
  const s = {
    what_worked: ['good; ok'],
    what_failed: [],
    tools_workflow: [],
    next_step: []
  };
  const out = splitExperienceSummary(s);
  assert.deepEqual(out.what_worked, []);
});

test('order preserved across multiple separators', () => {
  const s = {
    what_worked: [],
    what_failed: ['A is meaningful enough — B is meaningful enough; C is meaningful enough'],
    tools_workflow: [],
    next_step: []
  };
  const out = splitExperienceSummary(s);
  assert.deepEqual(out.what_failed, ['A is meaningful enough', 'B is meaningful enough', 'C is meaningful enough']);
});
