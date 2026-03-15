export function scoreAttention(snapshot) {
  const s = snapshot || {};

  const hasProblem = typeof s.current_problem === 'string' && s.current_problem.trim().length > 0;
  const hasActions = Array.isArray(s.recent_actions) && s.recent_actions.length > 0;
  const hasGaps = Array.isArray(s.memory_gaps) && s.memory_gaps.length > 0;

  const latestState = typeof s.evidence?.latest_relationship_state === 'string' ? s.evidence.latest_relationship_state : '';
  const hasEngaged = latestState === 'engaged' || latestState === 'interested';

  const components = {
    current_problem_weight: hasProblem ? 5 : 0,
    recent_activity_weight: hasActions ? 2 : 0,
    memory_gap_weight: hasGaps ? 2 : 0,
    engaged_bonus: hasEngaged ? 1 : 0
  };

  const attention_score = Object.values(components).reduce((a, b) => a + b, 0);
  return { ok: true, attention_score, components };
}
