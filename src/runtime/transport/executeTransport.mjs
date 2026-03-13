import { decideTransport } from './decideTransport.mjs';
import { createRelayClient } from './relayClient.mjs';

async function sendDirect({ peerUrl, payload, timeoutMs }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(peerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!r.ok) {
      const e = new Error(`executeTransport: direct send non-2xx (${r.status})`);
      e.code = 'DIRECT_NON_2XX';
      throw e;
    }
    return { ok: true, status: r.status };
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) {
      const err = new Error('executeTransport: direct send timeout');
      err.code = 'DIRECT_TIMEOUT';
      throw err;
    }
    const err = new Error('executeTransport: direct send failed');
    err.code = 'DIRECT_FAILED';
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Minimal transport executor.
 *
 * Steps:
 * 1) decideTransport(...)
 * 2) if direct: HTTP POST payload to peerUrl
 * 3) if relay: send payload via relayClient
 *
 * Hard rules:
 * - does not interpret payload
 * - does not modify payload/envelope
 * - no friendship logic
 */
export async function executeTransport({
  peerUrl,
  payload,
  relayAvailable,
  timeoutMs = 3000,
  relayUrl,
  nodeId,
  relayTo
} = {}) {
  if (!peerUrl || typeof peerUrl !== 'string') {
    const e = new Error('executeTransport: peerUrl must be string');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  if (payload == null) {
    const e = new Error('executeTransport: payload required');
    e.code = 'INVALID_INPUT';
    throw e;
  }

  const decision = await decideTransport({ peerUrl, timeoutMs, relayAvailable: !!relayAvailable });

  if (decision.transport === 'direct') {
    const sent = await sendDirect({ peerUrl, payload, timeoutMs });
    return {
      ok: true,
      transport: 'direct',
      directReachable: decision.directReachable,
      relayAvailable: decision.relayAvailable,
      reason: decision.reason,
      status: sent.status
    };
  }

  if (decision.transport === 'relay') {
    if (!relayUrl || !nodeId) {
      const e = new Error('executeTransport: relayUrl and nodeId required for relay transport');
      e.code = 'RELAY_MISCONFIGURED';
      throw e;
    }

    const client = createRelayClient({
      relayUrl,
      nodeId,
      onForward: () => {
        // executor is outbound-only
      }
    });

    try {
      await client.connect();
      await client.relay({ to: relayTo || peerUrl, payload });
      return {
        ok: true,
        transport: 'relay',
        directReachable: decision.directReachable,
        relayAvailable: decision.relayAvailable,
        reason: decision.reason,
        status: null
      };
    } finally {
      await client.close().catch(() => {});
    }
  }

  const e = new Error('executeTransport: unsupported transport');
  e.code = 'INTERNAL';
  throw e;
}
