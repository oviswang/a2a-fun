const MAX_SUMMARY = 280;
const MAX_ID = 128;

const ALLOWED_TYPES = new Set([
  'discovered_agent',
  'conversation_summary',
  'human_handoff_ready',
  'invocation_received',
  'invocation_completed'
]);

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function boundedString(raw, max, code) {
  if (typeof raw !== 'string') return { ok: false, code };
  const s = raw.trim();
  if (!s) return { ok: false, code };
  if (s.length > max) return { ok: false, code: 'TOO_LONG' };
  return { ok: true, value: s };
}

function optionalId(raw, code) {
  if (raw == null) return { ok: true, value: null };
  const out = boundedString(raw, MAX_ID, code);
  if (!out.ok) return out;
  return { ok: true, value: out.value };
}

export function createSocialFeedEvent({
  event_type,
  created_at,
  agent_id = null,
  peer_agent_id = null,
  summary,
  details = null
} = {}) {
  const t = boundedString(event_type, 64, 'INVALID_EVENT_TYPE');
  if (!t.ok || !ALLOWED_TYPES.has(t.value)) {
    return { ok: false, error: { code: 'INVALID_EVENT_TYPE' } };
  }

  const ca = boundedString(created_at, 64, 'INVALID_CREATED_AT');
  if (!ca.ok) return { ok: false, error: { code: 'INVALID_CREATED_AT' } };

  const a = optionalId(agent_id, 'INVALID_AGENT_ID');
  if (!a.ok) return { ok: false, error: { code: a.code || 'INVALID_AGENT_ID' } };

  const p = optionalId(peer_agent_id, 'INVALID_PEER_AGENT_ID');
  if (!p.ok) return { ok: false, error: { code: p.code || 'INVALID_PEER_AGENT_ID' } };

  const s = boundedString(summary, MAX_SUMMARY, 'INVALID_SUMMARY');
  if (!s.ok) return { ok: false, error: { code: 'INVALID_SUMMARY' } };

  if (!(details === null || isObj(details))) {
    return { ok: false, error: { code: 'INVALID_DETAILS' } };
  }

  return {
    ok: true,
    event: {
      event_type: t.value,
      created_at: ca.value,
      agent_id: a.value,
      peer_agent_id: p.value,
      summary: s.value,
      details
    }
  };
}

export function isSocialFeedEvent(x) {
  if (!isObj(x)) return false;
  if (!ALLOWED_TYPES.has(x.event_type)) return false;
  if (typeof x.created_at !== 'string') return false;
  if (!(x.agent_id === null || typeof x.agent_id === 'string')) return false;
  if (!(x.peer_agent_id === null || typeof x.peer_agent_id === 'string')) return false;
  if (typeof x.summary !== 'string') return false;
  if (!(x.details === null || isObj(x.details))) return false;
  return true;
}
