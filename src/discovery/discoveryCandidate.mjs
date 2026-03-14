// Discovery Layer (runtime primitive): discovery candidate
//
// Hard constraints:
// - no scoring / ranking
// - no conversation preview
// - no persistence
// - no capability/task logic
// - machine-safe output only

import { createHash } from 'node:crypto';

export const DISCOVERY_SOURCES = Object.freeze({
  KNOWN_PEERS: 'KNOWN_PEERS'
});

const DISCOVERY_SOURCE_ALLOWLIST = Object.freeze(Object.values(DISCOVERY_SOURCES));

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function assertNonEmptyString(v, name) {
  if (typeof v !== 'string' || v.trim() === '') throw err('INVALID_INPUT', `missing ${name}`);
}

function sha256hex(s) {
  return createHash('sha256').update(String(s), 'utf8').digest('hex');
}

/**
 * Deterministic constructor for a machine-safe discovery candidate.
 *
 * Shape:
 * {
 *   discovery_candidate_id,
 *   peer_actor_id,
 *   peer_url,
 *   source,
 *   created_at
 * }
 */
export function createDiscoveryCandidate(opts = {}) {
  if (!opts || typeof opts !== 'object' || Array.isArray(opts)) throw err('INVALID_INPUT', 'opts must be object');
  const { peer_actor_id, peer_url, source } = opts;

  assertNonEmptyString(peer_actor_id, 'peer_actor_id');
  assertNonEmptyString(peer_url, 'peer_url');
  assertNonEmptyString(source, 'source');

  if (!DISCOVERY_SOURCE_ALLOWLIST.includes(source)) throw err('INVALID_SOURCE', 'source not allowed');

  const material = `discovery|${source}|${peer_actor_id}|${peer_url}`;
  const discovery_candidate_id = `dcand:sha256:${sha256hex(material)}`;

  // Deterministic timestamp for this primitive (no wall-clock dependency).
  const created_at = new Date(0).toISOString();

  // Machine-safe, deterministic key order.
  return {
    discovery_candidate_id,
    peer_actor_id,
    peer_url,
    source,
    created_at
  };
}
