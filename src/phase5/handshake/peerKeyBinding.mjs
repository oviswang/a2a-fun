import { computePeerKeyFingerprint } from '../keys/fingerprint.mjs';

/**
 * Minimal peer key binding decision function (Phase 5 subset).
 *
 * Inputs are machine-safe identifiers only (peer_actor_id is hashed).
 *
 * Failure policy (fail closed):
 * - missing key -> throw (err.code='MISSING_KEY')
 * - mismatch with expected/bound -> throw (err.code='MISMATCH')
 *
 * Success policy:
 * - if no existing bound fpr: BOUND
 * - if already bound to the same fpr: ALREADY_BOUND
 */
export function bindPeerKeyFingerprint({
  peer_actor_id,
  peerPublicKeyPem,
  expected_peer_key_fpr = null,
  bound_peer_key_fpr = null
}) {
  if (!peer_actor_id || typeof peer_actor_id !== 'string') {
    const err = new Error('PeerKeyBinding: missing peer_actor_id');
    err.code = 'INVALID_INPUT';
    throw err;
  }

  if (!peerPublicKeyPem) {
    const err = new Error('PeerKeyBinding: missing peer public key (fail closed)');
    err.code = 'MISSING_KEY';
    throw err;
  }

  const peer_key_fpr = computePeerKeyFingerprint(peerPublicKeyPem);

  // Priority rule:
  // - If a bound key exists, it is authoritative.
  // - expected_peer_key_fpr is only used before first bind (when no bound key exists).
  // - If both exist and conflict, fail closed.
  if (bound_peer_key_fpr && expected_peer_key_fpr && bound_peer_key_fpr !== expected_peer_key_fpr) {
    const err = new Error('PeerKeyBinding: expected vs bound fingerprint conflict (fail closed)');
    err.code = 'MISMATCH';
    throw err;
  }

  if (bound_peer_key_fpr) {
    if (peer_key_fpr !== bound_peer_key_fpr) {
      const err = new Error('PeerKeyBinding: fingerprint mismatch vs bound key (fail closed)');
      err.code = 'MISMATCH';
      throw err;
    }

    return {
      status: 'ALREADY_BOUND',
      peer_key_fpr,
      patch: null
    };
  }

  if (expected_peer_key_fpr && peer_key_fpr !== expected_peer_key_fpr) {
    const err = new Error('PeerKeyBinding: fingerprint mismatch vs expected (fail closed)');
    err.code = 'MISMATCH';
    throw err;
  }

  return {
    status: 'BOUND',
    peer_key_fpr,
    patch: { peer_key_fpr }
  };
}
