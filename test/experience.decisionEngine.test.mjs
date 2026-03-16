import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveDecisionFromExperience } from '../src/experience/deriveDecisionFromExperience.mjs';

test('decision ordering respects operational priority and confidence', () => {
  const out = deriveDecisionFromExperience({
    topic: 'relay',
    knowledge: {
      what_worked: [
        { text: 'reuse it for replies', confidence_score: 0.9 },
        { text: 'keep one long-running inbound relay client', confidence_score: 0.8 }
      ],
      tools_workflow: [
        { text: 'fast loop of /nodes + /traces checks after each change', confidence_score: 0.85 }
      ],
      next_step: [
        { text: 'alert when /nodes shows multiple sessions for the same node_id', confidence_score: 0.7 }
      ]
    }
  });

  assert.deepEqual(out.decisions, [
    'alert when /nodes shows multiple sessions for the same node_id',
    'fast loop of /nodes + /traces checks after each change',
    'reuse it for replies'
  ]);
});

test('confidence threshold (<0.4) ignored', () => {
  const out = deriveDecisionFromExperience({
    topic: 'relay',
    knowledge: {
      next_step: [{ text: 'alert when /nodes shows multiple sessions', confidence_score: 0.39 }],
      tools_workflow: [{ text: 'check /nodes', confidence_score: 0.1 }],
      what_worked: [{ text: 'keep one inbound relay client', confidence_score: 0.5 }]
    }
  });
  assert.deepEqual(out.decisions, ['keep one inbound relay client']);
});

test('max decision limit enforced (3)', () => {
  const out = deriveDecisionFromExperience({
    topic: 'relay',
    knowledge: {
      next_step: [
        { text: 'n1', confidence_score: 0.9 },
        { text: 'n2', confidence_score: 0.8 },
        { text: 'n3', confidence_score: 0.7 },
        { text: 'n4', confidence_score: 0.6 }
      ],
      tools_workflow: [],
      what_worked: []
    }
  });
  assert.equal(out.decisions.length, 3);
  assert.deepEqual(out.decisions, ['n1', 'n2', 'n3']);
});
