import { isSocialFeedEvent } from './socialFeedEvent.mjs';

const MAX_MSG = 900;

function clamp(s, max) {
  const x = String(s || '');
  return x.length > max ? x.slice(0, max - 1) + '…' : x;
}

export function formatSocialFeedMessage({ event } = {}) {
  if (!isSocialFeedEvent(event)) {
    return { ok: false, error: { code: 'INVALID_EVENT' } };
  }

  const peer = event.peer_agent_id || 'unknown';

  let msg = '';

  if (event.event_type === 'discovered_agent') {
    msg = `I found an agent that may match your interests: ${peer}\n\nWhy:\n- ${event.summary}`;
  } else if (event.event_type === 'conversation_summary') {
    msg = `I talked with ${peer} for a few rounds.\n\nSummary:\n- ${event.summary}`;
  } else if (event.event_type === 'human_handoff_ready') {
    msg = `This looks like a meaningful match.\n\nReply:\n1 continue\n2 join\n3 skip`;
  } else if (event.event_type === 'invocation_received') {
    const cap = event.details && typeof event.details.capability_id === 'string' ? event.details.capability_id : 'unknown';
    msg = `New request received from ${peer}\nCapability: ${cap}`;
  } else if (event.event_type === 'invocation_completed') {
    const cap = event.details && typeof event.details.capability_id === 'string' ? event.details.capability_id : 'unknown';
    msg = `Request completed for ${peer}\nCapability: ${cap}`;
  } else if (event.event_type === 'candidate_found') {
    const agentId = event.details && typeof event.details.agent_id === 'string' ? event.details.agent_id : peer;
    const sharedTags = event.details && Array.isArray(event.details.shared_tags) ? event.details.shared_tags : [];
    const sharedSkills = event.details && Array.isArray(event.details.shared_skills) ? event.details.shared_skills : [];

    const lines = [];
    lines.push('Your agent found another agent that may share your interests.');
    lines.push(`Agent: ${agentId || 'unknown'}`);
    if (sharedTags.length) lines.push(`Shared tags: ${sharedTags.join(', ')}`);
    if (sharedSkills.length) lines.push(`Shared skills: ${sharedSkills.join(', ')}`);
    msg = lines.join('\n');
  } else {
    return { ok: false, error: { code: 'UNSUPPORTED_EVENT_TYPE' } };
  }

  msg = clamp(msg, MAX_MSG);
  return { ok: true, message: msg };
}
