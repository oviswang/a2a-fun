import { checkDirectReachability } from './checkDirectReachability.mjs';
import { selectTransport } from './selectTransport.mjs';

/**
 * Minimal runtime transport decision bridge.
 *
 * Composes:
 * - checkDirectReachability(...)
 * - selectTransport(...)
 *
 * Non-goals:
 * - protocol interpretation
 * - envelope sending
 * - friendship logic
 * - runtime-wide orchestration
 */
export async function decideTransport({ peerUrl, timeoutMs = 3000, relayAvailable = false } = {}) {
  if (typeof relayAvailable !== 'boolean') {
    const e = new Error('decideTransport: relayAvailable must be boolean');
    e.code = 'INVALID_INPUT';
    throw e;
  }

  const reach = await checkDirectReachability({ peerUrl, timeoutMs });
  const directReachable = reach.directReachable === true;

  const sel = selectTransport({ directReachable, relayAvailable });

  // Deterministic output shape: always the same keys.
  return {
    transport: sel.transport,
    directReachable,
    relayAvailable,
    reason: directReachable ? null : reach.reason ?? 'UNREACHABLE',
    status: directReachable ? reach.status ?? null : null
  };
}
