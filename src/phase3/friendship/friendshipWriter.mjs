// Phase 3 module (builds on top of Phase 2)
// Friendship write side-effect layer.
// Important: MUST NOT modify protocol state or SessionManager.

/**
 * Minimal side-effect writer.
 *
 * Contract:
 * - Only triggers when sessionState.state === 'MUTUAL_ENTRY_CONFIRMED'
 * - Idempotent on peer_actor_id: repeated calls must not duplicate records
 * - On storage failure: throw; do not mutate protocol state
 * - Produces a machine-safe audit record on successful write
 */
export async function writeFriendshipIfNeeded({
  sessionState,
  peer_actor_id,
  peer_key_fpr = null,
  session_id,
  storage,
  auditBinder
}) {
  if (!sessionState) throw new Error('friendshipWriter: missing sessionState');
  if (!peer_actor_id) throw new Error('friendshipWriter: missing peer_actor_id');
  if (!session_id) throw new Error('friendshipWriter: missing session_id');
  if (!storage) throw new Error('friendshipWriter: missing storage');
  if (!auditBinder) throw new Error('friendshipWriter: missing auditBinder');

  if (sessionState.state !== 'MUTUAL_ENTRY_CONFIRMED') {
    return { status: 'STATE_MISMATCH', did_write: false };
  }

  const { friends, save } = await loadFriendsStorage(storage);

  const exists = friends.some((r) => r && r.peer_actor_id === peer_actor_id);
  if (exists) return { status: 'IDEMPOTENT_SKIP', did_write: false };

  const established_at = new Date().toISOString();
  const record = {
    peer_actor_id,
    peer_key_fpr: peer_key_fpr ?? null,
    session_id,
    established_at
  };

  const nextFriends = [...friends, record];

  // Side-effect only: may throw. Caller must isolate this from protocol state.
  await save(nextFriends);

  // Audit boundary: peer_actor_id is a protocol identifier (hash) and is local-only.
  // It MUST be treated as local audit data and MUST NOT be transmitted outbound.
  const event_core = {
    kind: 'FRIENDSHIP_WRITE',
    action: 'CREATED',
    peer_actor_id,
    peer_key_fpr: peer_key_fpr ?? null,
    session_id,
    established_at
  };

  if (typeof auditBinder.bindFriendshipEventCore !== 'function') {
    throw new Error('friendshipWriter: auditBinder.bindFriendshipEventCore missing');
  }

  const audit_record = auditBinder.bindFriendshipEventCore({ event_core });

  return {
    status: 'WROTE',
    did_write: true,
    record,
    audit_record
  };
}

async function loadFriendsStorage(storage) {
  // Preferred interface
  if (typeof storage.readFriends === 'function' && typeof storage.writeFriends === 'function') {
    const friends = (await storage.readFriends()) ?? [];
    if (!Array.isArray(friends)) throw new Error('friendshipWriter: friends storage must be an array');
    return {
      friends,
      save: async (arr) => storage.writeFriends(arr)
    };
  }

  // Generic JSON interface (friends.json)
  if (typeof storage.readJson === 'function' && typeof storage.writeJson === 'function') {
    const friends = (await storage.readJson('friends.json')) ?? [];
    if (!Array.isArray(friends)) throw new Error('friendshipWriter: friends.json must be an array');
    return {
      friends,
      save: async (arr) => storage.writeJson('friends.json', arr)
    };
  }

  throw new Error('friendshipWriter: unsupported storage interface');
}
