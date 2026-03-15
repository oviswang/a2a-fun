import { createConversationGoal } from './conversationGoal.mjs';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function pickTopic(snapshot) {
  const topics = Array.isArray(snapshot?.current_topics) ? snapshot.current_topics : [];
  if (topics.length) return safeStr(topics[0]);
  const focus = safeStr(snapshot?.current_problem);
  if (focus) return focus.slice(0, 80);
  return 'general';
}

function pickIntent({ snapshot, memory_gaps } = {}) {
  const gaps = Array.isArray(memory_gaps) ? memory_gaps : (Array.isArray(snapshot?.memory_gaps) ? snapshot.memory_gaps : []);
  const gapText = gaps.map((g) => safeStr(g).toLowerCase()).join(' | ');

  if (gapText.includes('no verified') || gapText.includes('no engaged') || gapText.includes('no local peer')) {
    return 'experience_exchange';
  }

  if (gapText.includes('verify') || gapText.includes('unconfirmed')) {
    return 'experience_verification';
  }

  return 'peer_referral';
}

function buildQuestion(intent, topic) {
  if (intent === 'experience_exchange') {
    return `On topic "${topic}": what actually worked, what failed, and which tool/workflow did your human use?`; 
  }
  if (intent === 'experience_verification') {
    return `On topic "${topic}": can you verify one concrete claim with evidence-like details (exact steps, checks, observed result)?`;
  }
  return `On topic "${topic}": do you know a peer who has relevant real experience? If yes, who and why?`;
}

function buildExpectedOutput(intent) {
  if (intent === 'experience_exchange') return 'A concise report: what worked, what failed, tool/workflow used, and one suggested next step.';
  if (intent === 'experience_verification') return 'A concrete verification: exact steps + checks + observed result, plus one caveat/edge case.';
  return 'A referral: one peer agent id, what they are good at, and why they are relevant.';
}

export function buildConversationGoal({ attention_snapshot, selected_peer, memory_gaps } = {}) {
  const snap = attention_snapshot || {};
  const topic = pickTopic(snap);
  const intent = pickIntent({ snapshot: snap, memory_gaps });

  const peerReason = safeStr(selected_peer?.reason) || safeStr(selected_peer?.selected_peer_reason) || '';
  const primaryGap = (Array.isArray(snap.memory_gaps) && snap.memory_gaps.length) ? safeStr(snap.memory_gaps[0]) : (Array.isArray(memory_gaps) && memory_gaps.length ? safeStr(memory_gaps[0]) : '');

  const out = createConversationGoal({
    topic,
    intent,
    question: buildQuestion(intent, topic),
    expected_output: buildExpectedOutput(intent),
    source: {
      current_focus: safeStr(snap.current_problem),
      memory_gap: primaryGap,
      selected_peer_reason: peerReason
    }
  });

  if (out.ok) console.log(JSON.stringify({ ok: true, event: 'CONVERSATION_GOAL_BUILT', intent: out.goal.intent, topic: out.goal.topic }));
  return out;
}
