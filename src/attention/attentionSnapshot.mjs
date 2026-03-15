export function createEmptyAttentionSnapshot({ agent_id } = {}) {
  return {
    agent_id: typeof agent_id === 'string' ? agent_id.trim() : '',
    updated_at: null,
    current_problem: null,
    current_topics: [],
    recent_actions: [],
    recent_tools: [],
    memory_gaps: [],
    preferred_peer_types: [],
    attention_score: 0,
    score_components: null,
    evidence: {
      openclaw_focus: null,
      openclaw_recent_tasks: [],
      openclaw_recent_tools: [],
      openclaw_recent_topics: [],
      node_recent_events: [],
      latest_peer: null,
      latest_relationship_state: null
    }
  };
}
