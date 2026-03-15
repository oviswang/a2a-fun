import { resolveActiveGateway } from './gatewayResolver.mjs';
import { createSocialFeedEvent } from './socialFeedEvent.mjs';
import { formatSocialFeedMessage } from './socialFeedFormatter.mjs';
import { deliverSocialFeedMessage } from './socialFeedDelivery.mjs';

function logMachineSafe(obj) {
  try {
    // One-line JSON for log shippers.
    console.log(JSON.stringify(obj));
  } catch {
    // ignore
  }
}

function getRuntimeContext() {
  return globalThis.__A2A_SOCIAL_CONTEXT || null;
}

function getSendFn() {
  return globalThis.__A2A_SOCIAL_SEND || null;
}

function getAgentId() {
  const v = globalThis.__A2A_AGENT_ID;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export async function bestEffortEmitSocialFeed({ event_type, peer_agent_id = null, summary, details = null } = {}) {
  try {
    const context = getRuntimeContext();
    const send = getSendFn();
    if (typeof send !== 'function') return { ok: true, emitted: false };

    const gw = resolveActiveGateway({ context });
    if (!gw.ok || gw.gateway === 'unknown') return { ok: true, emitted: false };

    const evOut = createSocialFeedEvent({
      event_type,
      created_at: new Date().toISOString(),
      agent_id: getAgentId(),
      peer_agent_id,
      summary,
      details
    });
    if (!evOut.ok) return { ok: true, emitted: false };

    const fm = formatSocialFeedMessage({ event: evOut.event });
    if (!fm.ok) return { ok: true, emitted: false };

    const delivery = await deliverSocialFeedMessage({
      gateway: gw.gateway,
      channel_id: gw.channel_id,
      message: fm.message,
      send
    });

    logMachineSafe({
      ok: true,
      event: 'social_feed_delivery',
      gateway: gw.gateway,
      channel_id: gw.channel_id,
      delivered: delivery?.delivered === true,
      send_ok: delivery?.ok === true,
      send_result: delivery?.send_result ?? null,
      error_code: delivery?.error?.code ?? null
    });

    return { ok: true, emitted: true, delivery: delivery ?? null };
  } catch {
    // Best-effort only: never break runtime.
    return { ok: true, emitted: false };
  }
}
