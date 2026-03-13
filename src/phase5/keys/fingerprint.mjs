import { createHash } from 'node:crypto';

/**
 * Compute a stable fingerprint for a peer public key.
 * Minimal rule (Phase 5 subset):
 *   peer_key_fpr = 'sha256:' + hex(SHA-256(UTF8(peerPublicKeyPem)))
 *
 * Notes:
 * - This is local-only binding metadata.
 * - Do not include raw handles; fingerprint is derived from the key material only.
 */
export function computePeerKeyFingerprint(peerPublicKeyPem) {
  if (!peerPublicKeyPem || typeof peerPublicKeyPem !== 'string') {
    throw new Error('PeerKeyFpr: missing peerPublicKeyPem');
  }
  const hex = createHash('sha256').update(Buffer.from(peerPublicKeyPem, 'utf8')).digest('hex');
  return `sha256:${hex}`;
}
