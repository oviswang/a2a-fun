import { shouldEstablishFriendship } from './socialHandoffState.mjs';

export function applyHumanJoinFriendshipRule({ handoff_state } = {}) {
  const out = shouldEstablishFriendship({ handoff_state });
  if (!out.ok) return { ok: false, error: out.error };

  return { ok: true, friendship_established: out.friendship_established === true };
}
