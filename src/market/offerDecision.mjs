import { shouldAcceptTask } from './taskDecision.mjs';

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
      reputation_score: context?.reputation_score
    },
    { node_id: context?.node_id, dataDir: context?.dataDir }
  );

  if (!decision.accepted) {
    return { offer_id: offer?.offer_id || null, accepted: false, reason: decision.reason, detail: decision.detail };
  }

  return { offer_id: offer?.offer_id || null, accepted: true, detail: decision.detail };
}
