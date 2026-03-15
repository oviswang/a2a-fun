function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

export function explainAttentionDecision({ snapshot, peerSelection } = {}) {
  const focus = safeStr(snapshot?.current_problem);
  const topics = Array.isArray(snapshot?.current_topics) ? snapshot.current_topics : [];
  const gaps = Array.isArray(snapshot?.memory_gaps) ? snapshot.memory_gaps : [];

  const peer = peerSelection?.ok ? safeStr(peerSelection.selected_peer_agent_id) : '';
  const reason = peerSelection?.ok ? safeStr(peerSelection.reason) : '';

  const lines = [];
  if (focus) lines.push(`Current focus: ${focus}.`);
  if (topics.length) lines.push(`Topics: ${topics.slice(0, 6).join(', ')}.`);
  if (gaps.length) lines.push(`Memory gaps: ${gaps.slice(0, 4).join('; ')}.`);
  if (peer) lines.push(`Selected peer: ${peer}${reason ? ` (${reason})` : ''}.`);

  const text = lines.join(' ');
  console.log(JSON.stringify({ ok: true, event: 'ATTENTION_DECISION_EXPLAINED' }));
  return { ok: true, text };
}
