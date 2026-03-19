import crypto from 'node:crypto';
import { appendOfferFeedEvent } from './offerFeed.mjs';

function nowIso() {
  return new Date().toISOString();
}

function num(x, dflt) {
  const n = Number(x);
  return Number.isFinite(n) ? n : dflt;
}

export function createTaskOffer({
  task_type,
  expected_value,
  payload,
  timeout_ms,
  source_super_identity_id,
  metadata,
  dataDir
} = {}) {
  const offer = {
    offer_id: `offer-${crypto.randomUUID()}`,
    task_type: String(task_type || '').trim() || 'unknown',
    expected_value: num(expected_value, 1),
    payload: payload && typeof payload === 'object' ? payload : {},
    timeout_ms: num(timeout_ms, 30_000),
    created_at: nowIso(),
    source_super_identity_id: String(source_super_identity_id || '').trim() || null,
    metadata: metadata && typeof metadata === 'object' ? metadata : {}
  };

  try {
    process.stdout.write(`${JSON.stringify({ ok: true, event: 'TASK_OFFER_CREATED', ts: nowIso(), offer })}\n`);
  } catch {}

  // best-effort offer feed
  try {
    appendOfferFeedEvent(
      {
        offer_id: offer.offer_id,
        event_type: 'offer_created',
        task_type: offer.task_type,
        expected_value: offer.expected_value,
        source_super_identity_id: offer.source_super_identity_id,
        metadata: { timeout_ms: offer.timeout_ms }
      },
      { dataDir }
    );
  } catch {}

  return { ok: true, offer };
}
