import { validateRemoteHumanJoinSignal } from './remoteHumanJoinSignal.mjs';
import { applyRemoteJoinSignal } from './socialHandoffState.mjs';
import { applyHumanJoinFriendshipRule } from './socialFriendshipTrigger.mjs';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function fail(code) {
  return { ok: false, handoff_state: null, friendship_established: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export function handleRemoteHumanJoinSignal({ payload, handoff_state } = {}) {
  if (!isObj(payload)) return fail('INVALID_PAYLOAD');
  if (payload.kind !== 'REMOTE_HUMAN_JOIN_SIGNAL') return fail('INVALID_KIND');
  if (!isObj(payload.signal)) return fail('INVALID_SIGNAL');

  const vs = validateRemoteHumanJoinSignal(payload.signal);
  if (!vs.ok) return fail(vs.error?.code || 'INVALID_SIGNAL');

  const next = applyRemoteJoinSignal({ handoff_state });
  if (!next.ok) return fail(next.error?.code || 'INVALID_STATE');

  const fr = applyHumanJoinFriendshipRule({ handoff_state: next.handoff_state });
  if (!fr.ok) return fail(fr.error?.code || 'FRIENDSHIP_RULE_FAILED');

  return {
    ok: true,
    handoff_state: next.handoff_state,
    friendship_established: fr.friendship_established === true,
    error: null
  };
}
