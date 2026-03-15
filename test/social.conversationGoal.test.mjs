import test from 'node:test';
import assert from 'node:assert/strict';

import { createConversationGoal } from '../src/social/conversationGoal.mjs';
import { buildConversationGoal } from '../src/social/buildConversationGoal.mjs';


test('createConversationGoal rejects unsupported intent', () => {
  const out = createConversationGoal({ topic: 'x', intent: 'random', question: 'q', expected_output: 'e', source: {} });
  assert.equal(out.ok, false);
});

test('buildConversationGoal chooses experience_exchange when gaps include no verified', () => {
  const attention_snapshot = { current_topics: ['trading'], current_problem: 'stock trading', memory_gaps: ['no verified peer experience for topic: relay'] };
  const sel = { ok: true, selected_peer_agent_id: 'peerA', reason: 'local_memory_top_score' };
  const out = buildConversationGoal({ attention_snapshot, selected_peer: sel, memory_gaps: attention_snapshot.memory_gaps });
  assert.equal(out.ok, true);
  assert.equal(out.goal.intent, 'experience_exchange');
  assert.ok(out.goal.question.includes('what actually worked'));
});
