// PHASE 2 FROZEN
// Behavior must remain stable unless fixing a critical bug.

import { createHash } from 'node:crypto';
import { jcsStringify } from '../../identity/jcs.mjs';

/**
 * Hard rule:
 * event_hash = SHA-256( UTF8( JCS(event_core) ) )
 */
export function computeEventHash(event_core) {
  const canon = jcsStringify(event_core);
  return createHash('sha256').update(canon, 'utf8').digest('hex');
}
