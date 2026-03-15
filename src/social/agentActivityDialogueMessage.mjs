function nowIso() {
  return new Date().toISOString();
}

function safe(s) {
  return typeof s === 'string' ? s.trim() : '';
}

export function createAgentActivityDialogueMessage({
  dialogue_id,
  turn,
  from_agent_id,
  to_agent_id,
  hostname,
  recent_activity,
  message,
  timestamp
} = {}) {
  const did = safe(dialogue_id);
  const fromId = safe(from_agent_id);
  const toId = safe(to_agent_id);
  const host = safe(hostname);
  const msg = safe(message);
  const ts = safe(timestamp) || nowIso();

  const turnNum = Number(turn);
  if (!did) return { ok: false, error: { code: 'INVALID_DIALOGUE_ID' } };
  if (!Number.isFinite(turnNum) || turnNum < 1 || turnNum > 6) return { ok: false, error: { code: 'INVALID_TURN' } };
  if (!fromId) return { ok: false, error: { code: 'INVALID_FROM' } };
  if (!toId) return { ok: false, error: { code: 'INVALID_TO' } };
  if (!host) return { ok: false, error: { code: 'INVALID_HOSTNAME' } };
  if (!msg) return { ok: false, error: { code: 'INVALID_MESSAGE' } };

  const ra = recent_activity && typeof recent_activity === 'object' ? recent_activity : null;

  return {
    ok: true,
    message: {
      kind: 'AGENT_ACTIVITY_DIALOGUE',
      dialogue_id: did,
      turn: turnNum,
      from_agent_id: fromId,
      to_agent_id: toId,
      hostname: host,
      recent_activity: ra,
      message: msg,
      timestamp: ts
    },
    error: null
  };
}

export function isAgentActivityDialogueMessage(obj) {
  return obj && typeof obj === 'object' && obj.kind === 'AGENT_ACTIVITY_DIALOGUE';
}
