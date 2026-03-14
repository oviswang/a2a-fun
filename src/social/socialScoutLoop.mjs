import { resolveActiveGateway } from './gatewayResolver.mjs';
import { formatSocialFeedMessage } from './socialFeedFormatter.mjs';
import { deliverSocialFeedMessage } from './socialFeedDelivery.mjs';

export function runSocialScoutLoop({
  context,
  send,
  scout,
  intervalMs = 5 * 60 * 1000,
  enabled = false
} = {}) {
  if (!enabled) {
    return { ok: true, started: false, stop: async () => {} };
  }
  if (typeof scout !== 'function') {
    return { ok: false, error: { code: 'MISSING_SCOUT' } };
  }

  let stopped = false;
  let timer = null;

  async function tick() {
    if (stopped) return;

    const gw = resolveActiveGateway({ context });
    const events = await Promise.resolve(scout()).catch(() => []);

    if (Array.isArray(events)) {
      for (const ev of events) {
        const fm = formatSocialFeedMessage({ event: ev });
        if (!fm.ok) continue;
        await deliverSocialFeedMessage({
          gateway: gw.gateway,
          channel_id: gw.channel_id,
          message: fm.message,
          send
        }).catch(() => {});
      }
    }

    if (!stopped) {
      timer = setTimeout(tick, Math.max(10_000, Number(intervalMs) || 0));
    }
  }

  timer = setTimeout(tick, 0);

  return {
    ok: true,
    started: true,
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
}
