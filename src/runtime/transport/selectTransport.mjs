/**
 * Minimal transport selection bridge.
 *
 * Encodes the baseline rules from TRANSPORT_SELECTION.md:
 * - direct first
 * - relay second
 * - mailbox NOT part of baseline selection
 *
 * Inputs are booleans; output is machine-safe + deterministic.
 *
 * Non-goals:
 * - protocol interpretation
 * - envelope changes
 * - friendship logic
 * - orchestration/retry/backoff
 */
export function selectTransport({ directReachable, relayAvailable } = {}) {
  if (typeof directReachable !== 'boolean') {
    const e = new Error('selectTransport: directReachable must be boolean');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  if (typeof relayAvailable !== 'boolean') {
    const e = new Error('selectTransport: relayAvailable must be boolean');
    e.code = 'INVALID_INPUT';
    throw e;
  }

  // Hard rules.
  if (directReachable === true) return { transport: 'direct' };
  if (directReachable === false && relayAvailable === true) return { transport: 'relay' };

  const e = new Error('selectTransport: no usable transport');
  e.code = 'NO_USABLE_TRANSPORT';
  throw e;
}
