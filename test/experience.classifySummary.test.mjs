import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyExperienceSummary } from '../src/experience/classifyExperienceSummary.mjs';

test('safeguard sentence goes to next_step', () => {
  const out = classifyExperienceSummary({
    what_worked: [],
    what_failed: [],
    tools_workflow: [],
    next_step: ['If I had to pick one safeguard: alert when /nodes shows multiple sessions for the same node_id.']
  });
  assert.equal(out.next_step.length, 1);
  assert.equal(out.tools_workflow.length, 0);
});

test('/nodes + /traces sentence goes to tools_workflow', () => {
  const out = classifyExperienceSummary({
    what_worked: [],
    what_failed: [],
    tools_workflow: [],
    next_step: ['I trust a fast loop of /nodes + /traces checks after each change.']
  });
  assert.equal(out.tools_workflow.length, 1);
});

test('session churn sentence goes to what_failed', () => {
  const out = classifyExperienceSummary({
    what_worked: [],
    what_failed: [],
    tools_workflow: [],
    next_step: ['Session churn is the main culprit; avoid one-shot clients.']
  });
  assert.equal(out.what_failed.length, 1);
});

test('keep one long-running inbound relay client goes to what_worked', () => {
  const out = classifyExperienceSummary({
    what_worked: [],
    what_failed: [],
    tools_workflow: [],
    next_step: ['Keep one long-running inbound relay client and reuse it for replies.']
  });
  assert.equal(out.what_worked.length, 1);
});

test('mixed signal follows tie-break rule (next_step > tools > failed > worked)', () => {
  const out = classifyExperienceSummary({
    what_worked: [],
    what_failed: [],
    tools_workflow: [],
    next_step: ['Suggest you monitor /nodes to detect churn issues.']
  });
  assert.equal(out.next_step.length, 1);
  assert.equal(out.tools_workflow.length, 0);
  assert.equal(out.what_failed.length, 0);
});
