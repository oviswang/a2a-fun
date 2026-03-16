import test from 'node:test';
import assert from 'node:assert/strict';

import { buildExperienceContext } from '../src/experience/buildExperienceContext.mjs';

test('empty knowledge', () => {
  const out = buildExperienceContext({ topic: 'relay', knowledge: { what_worked: [], what_failed: [], tools_workflow: [], next_step: [] } });
  assert.ok(out.includes('EXPERIENCE_CONTEXT'));
  assert.ok(out.includes('Topic: relay'));
  assert.ok(out.length <= 500);
});

test('partial knowledge', () => {
  const out = buildExperienceContext({
    topic: 'relay',
    knowledge: { what_worked: ['keep one long-running inbound relay client'], what_failed: [], tools_workflow: [], next_step: [] }
  });
  assert.ok(out.includes('Known successful patterns:'));
  assert.ok(out.includes('- keep one long-running inbound relay client'));
  assert.ok(out.length <= 500);
});

test('full relay knowledge', () => {
  const out = buildExperienceContext({
    topic: 'relay',
    knowledge: {
      what_worked: ['keep one long-running inbound relay client', 'reuse it for replies'],
      what_failed: ['session churn is the main culprit'],
      tools_workflow: ['fast loop of /nodes + /traces checks after each change'],
      next_step: ['alert when /nodes shows multiple sessions for the same node_id']
    }
  });
  assert.ok(out.includes('Known failure patterns:'));
  assert.ok(out.includes('Suggested safeguards:'));
  assert.ok(out.length <= 500);
});

test('truncation behavior', () => {
  const long = Array.from({ length: 20 }, (_, i) => `item ${i} ` + 'x'.repeat(50));
  const out = buildExperienceContext({
    topic: 'relay',
    knowledge: { what_worked: long, what_failed: long, tools_workflow: long, next_step: long }
  });
  assert.ok(out.length <= 500);
  if (out.length >= 498) assert.ok(out.endsWith('...'));
});
