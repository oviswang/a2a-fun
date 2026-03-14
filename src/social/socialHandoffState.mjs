import { createHash } from 'node:crypto';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function sha256hex(s) {
  return createHash('sha256').update(String(s), 'utf8').digest('hex');
}

export function createHandoffState({ handoff_id } = {}) {
  if (typeof handoff_id !== 'string' || !handoff_id.trim()) {
    return { ok: false, error: { code: 'INVALID_HANDOFF_ID' } };
  }
  const id = handoff_id.trim();

  return {
    ok: true,
    handoff_state: {
      handoff_id: `handoff:sha256:${sha256hex(id)}`,
      local_human_joined: false,
      remote_human_joined: false,
      friendship_established: false
    }
  };
}

export function applyLocalReplyAction({ handoff_state, action } = {}) {
  if (!isObj(handoff_state)) return { ok: false, error: { code: 'INVALID_STATE' } };
  if (typeof action !== 'string') return { ok: false, error: { code: 'INVALID_ACTION' } };

  const a = action.trim();
  if (a !== 'continue' && a !== 'join' && a !== 'skip') {
    return { ok: false, error: { code: 'INVALID_ACTION' } };
  }

  const next = { ...handoff_state };

  if (a === 'join') next.local_human_joined = true;

  // friendship establishment rule is deterministic and monotonic.
  if (next.local_human_joined === true && next.remote_human_joined === true) {
    next.friendship_established = true;
  }

  return { ok: true, handoff_state: next };
}

export function applyRemoteJoinSignal({ handoff_state } = {}) {
  if (!isObj(handoff_state)) return { ok: false, error: { code: 'INVALID_STATE' } };

  const next = { ...handoff_state, remote_human_joined: true };

  if (next.local_human_joined === true && next.remote_human_joined === true) {
    next.friendship_established = true;
  }

  return { ok: true, handoff_state: next };
}

export function shouldEstablishFriendship({ handoff_state } = {}) {
  if (!isObj(handoff_state)) return { ok: false, error: { code: 'INVALID_STATE' } };
  const yes = handoff_state.friendship_established === true ||
    (handoff_state.local_human_joined === true && handoff_state.remote_human_joined === true);
  return { ok: true, friendship_established: !!yes };
}
