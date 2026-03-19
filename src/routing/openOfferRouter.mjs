import { appendOfferFeedEvent } from '../market/offerFeed.mjs';

function num(x, dflt) {
  const n = Number(x);
  return Number.isFinite(n) ? n : dflt;
}

function nowIso() {
  return new Date().toISOString();
}

function log(event, payload) {
  try {
    process.stdout.write(`${JSON.stringify({ ok: true, event, ts: nowIso(), ...payload })}\n`);
  } catch {}
}

/**
 * Open-offer routing flow:
 * candidates: array
 * offer: explicit offer structure
 * sendOfferFn: ({ candidate, offer }) => Promise<{ offer_id, accepted, reason? }>
 * executeFn: ({ candidate, offer }) => Promise<{ ok:boolean, result?:any }>
 */
export async function routeOfferWithFallback({ candidates, offer, sendOfferFn, executeFn, maxAttempts, dataDir } = {}) {
  const cand = Array.isArray(candidates) ? candidates : [];
  const max = Math.min(num(maxAttempts, 5), cand.length);
  if (typeof sendOfferFn !== 'function') return { ok: false, error: { code: 'MISSING_SEND_OFFER_FN' } };
  if (typeof executeFn !== 'function') return { ok: false, error: { code: 'MISSING_EXECUTE_FN' } };

  const attempts = [];

  for (let i = 0; i < max; i++) {
    const c = cand[i];

    log('TASK_OFFER_SENT', { offer_id: offer?.offer_id || null, candidate: c?.node_id || c?.agent_id || null, expected_value: offer?.expected_value ?? 1 });
    try {
      appendOfferFeedEvent(
        {
          offer_id: offer?.offer_id || null,
          event_type: 'offer_sent',
          task_type: offer?.task_type || null,
          expected_value: typeof offer?.expected_value === 'number' ? offer.expected_value : 1,
          source_super_identity_id: offer?.source_super_identity_id || null,
          target_node_id: c?.node_id || c?.agent_id || null
        },
        { dataDir }
      );
    } catch {}

    const decision = await sendOfferFn({ candidate: c, offer });

    if (!decision || decision.offer_id !== offer?.offer_id) {
      log('TASK_OFFER_EXPIRED', { offer_id: offer?.offer_id || null, candidate: c?.node_id || c?.agent_id || null, reason: 'no_response_or_mismatched_offer_id' });
      try {
        appendOfferFeedEvent(
          {
            offer_id: offer?.offer_id || null,
            event_type: 'offer_expired',
            task_type: offer?.task_type || null,
            expected_value: typeof offer?.expected_value === 'number' ? offer.expected_value : 1,
            source_super_identity_id: offer?.source_super_identity_id || null,
            target_node_id: c?.node_id || c?.agent_id || null,
            reason: 'expired'
          },
          { dataDir }
        );
      } catch {}
      attempts.push({ candidate: c?.node_id || c?.agent_id || null, accepted: false, reason: 'expired' });
      continue;
    }

    if (!decision.accepted) {
      log('TASK_OFFER_REJECTED', { offer_id: offer.offer_id, candidate: c?.node_id || c?.agent_id || null, reason: decision.reason || 'rejected' });
      try {
        appendOfferFeedEvent(
          {
            offer_id: offer.offer_id,
            event_type: 'offer_rejected',
            task_type: offer?.task_type || null,
            expected_value: typeof offer?.expected_value === 'number' ? offer.expected_value : 1,
            source_super_identity_id: offer?.source_super_identity_id || null,
            target_node_id: c?.node_id || c?.agent_id || null,
            reason: decision.reason || 'rejected'
          },
          { dataDir }
        );
      } catch {}
      attempts.push({ candidate: c?.node_id || c?.agent_id || null, accepted: false, reason: decision.reason || 'rejected' });
      continue;
    }

    log('TASK_OFFER_ACCEPTED', { offer_id: offer.offer_id, candidate: c?.node_id || c?.agent_id || null });
    try {
      appendOfferFeedEvent(
        {
          offer_id: offer.offer_id,
          event_type: 'offer_accepted',
          task_type: offer?.task_type || null,
          expected_value: typeof offer?.expected_value === 'number' ? offer.expected_value : 1,
          source_super_identity_id: offer?.source_super_identity_id || null,
          target_node_id: c?.node_id || c?.agent_id || null
        },
        { dataDir }
      );
    } catch {}
    attempts.push({ candidate: c?.node_id || c?.agent_id || null, accepted: true, reason: 'accepted' });

    const execOut = await executeFn({ candidate: c, offer });
    try {
      if (execOut?.ok) {
        appendOfferFeedEvent(
          {
            offer_id: offer.offer_id,
            event_type: 'offer_executed',
            task_type: offer?.task_type || null,
            expected_value: typeof offer?.expected_value === 'number' ? offer.expected_value : 1,
            source_super_identity_id: offer?.source_super_identity_id || null,
            target_node_id: c?.node_id || c?.agent_id || null,
            metadata: { execution_ok: true }
          },
          { dataDir }
        );
      }
    } catch {}

    return { ok: true, selected: c, offer_id: offer.offer_id, attempts, execution: execOut };
  }

  return { ok: false, error: { code: 'ALL_REJECTED' }, offer_id: offer?.offer_id || null, attempts };
}
