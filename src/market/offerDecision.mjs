import { shouldAcceptTask } from './taskDecision.mjs';
import { appendOfferFeedEvent } from './offerFeed.mjs';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

/**
 * Explicit offer decision.
 * - Reuses shouldAcceptTask for adaptive thresholding.
 * - Adds minimal 'unsupported' guard.
 */
export function shouldAcceptOffer(offer, context = {}) {
  const task_type = safeStr(offer?.task_type);
  if (!task_type || task_type === 'unknown') {
    return { offer_id: offer?.offer_id || null, accepted: false, reason: 'unsupported' };
  }

  const decision = shouldAcceptTask(
    {
      expected_value: offer?.expected_value,
      reputation_score: context?.reputation_score,
      task_type: task_type,
      channel: context?.channel || 'pull',
      node_super_identity_id: context?.node_super_identity_id || null
    },
    { node_id: context?.node_id, dataDir: context?.dataDir }
  );

  // best-effort: record decision into offer_feed for strategy profiling (derived, rebuildable)
  try {
    appendOfferFeedEvent(
      {
        offer_id: offer?.offer_id || null,
        event_type: 'offer_decision',
        task_type: task_type,
        expected_value: Number(offer?.expected_value ?? 1),
        target_node_id: context?.node_id || null,
        target_super_identity_id: context?.node_super_identity_id || null,
        reason: decision.accepted ? null : decision.reason,
        metadata: {
          accepted: decision.accepted,
          current_threshold: decision.detail?.current_threshold ?? null,
          original_expected_value: decision.detail?.original_expected_value ?? null,
          effective_expected_value: decision.detail?.effective_expected_value ?? null,
          preference_weight_task: decision.detail?.preference_weight_task ?? null,
          preference_weight_channel: decision.detail?.preference_weight_channel ?? null,
          task_type: decision.detail?.task_type ?? null,
          channel: decision.detail?.channel ?? null
        }
      },
      { dataDir: context?.dataDir }
    );
  } catch {}

  if (!decision.accepted) {
    return { offer_id: offer?.offer_id || null, accepted: false, reason: decision.reason, detail: decision.detail };
  }

  return { offer_id: offer?.offer_id || null, accepted: true, detail: decision.detail };
}
