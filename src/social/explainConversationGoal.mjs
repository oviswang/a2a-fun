function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

export function explainConversationGoal({ attention_snapshot, selected_peer, goal } = {}) {
  const focus = safeStr(attention_snapshot?.current_problem);
  const gap = safeStr(goal?.source?.memory_gap || attention_snapshot?.memory_gaps?.[0]);
  const peer = safeStr(selected_peer?.selected_peer_agent_id || selected_peer?.peer_agent_id || '');
  const peerReason = safeStr(goal?.source?.selected_peer_reason || selected_peer?.reason || '');

  const lines = [];
  if (focus) lines.push(`Current focus: ${focus}.`);
  if (gap) lines.push(`Memory gap: ${gap}.`);
  if (peer) lines.push(`Selected peer: ${peer}${peerReason ? ` (${peerReason})` : ''}.`);
  if (goal?.intent) lines.push(`Intent: ${safeStr(goal.intent)}.`);
  if (goal?.expected_output) lines.push(`Expected output: ${safeStr(goal.expected_output)}`);

  const text = lines.join(' ');
  console.log(JSON.stringify({ ok: true, event: 'CONVERSATION_GOAL_EXPLAINED' }));
  return { ok: true, text };
}
