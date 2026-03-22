import { selectCandidateReputationAware } from './reputationAwareRouting.mjs';

function safeStr(s) { return typeof s === 'string' ? s.trim() : ''; }

export function partitionByAvailability(candidates, registryNodes) {
  const buckets = { available: [], stale: [], unknown: [], unavailable: [] };
  for (const c of candidates || []) {
    const id = safeStr(c?.agent_id);
    const r = id && registryNodes?.[id] ? registryNodes[id] : null;
    const status = safeStr(r?.availability_status) || 'unknown';
    if (status === 'available') buckets.available.push(c);
    else if (status === 'stale') buckets.stale.push(c);
    else if (status === 'unavailable') buckets.unavailable.push(c);
    else buckets.unknown.push(c);
  }
  return buckets;
}

export function selectCandidateAvailabilityAware({ candidates, task_type, registry, dataDir, rng } = {}) {
  const nodes = registry?.nodes && typeof registry.nodes === 'object' ? registry.nodes : {};

  const cap = safeStr(task_type);
  const cand0 = Array.isArray(candidates) ? candidates : [];

  // 1) capability filter first
  const capFiltered = cap
    ? cand0.filter((c) => {
        const id = safeStr(c?.agent_id);
        const r = id && nodes[id] ? nodes[id] : null;
        const caps = Array.isArray(r?.capabilities) ? r.capabilities : (Array.isArray(c?.skills) ? c.skills : []);
        return caps.map(safeStr).includes(cap);
      })
    : cand0;

  const buckets = partitionByAvailability(capFiltered, nodes);
  const order = ['available', 'stale', 'unknown'];

  let bucket = null;
  for (const b of order) {
    if (buckets[b].length) { bucket = b; break; }
  }

  if (!bucket) {
    return {
      ok: false,
      error: { code: 'NO_AVAILABLE_RESPONDER' },
      routing: {
        availability_status: 'unavailable',
        availability_bucket: 'unavailable',
        availability_reason: 'no_candidates_in_available_stale_unknown',
        candidate_count: 0,
        bucket_counts: {
          available: buckets.available.length,
          stale: buckets.stale.length,
          unknown: buckets.unknown.length,
          unavailable: buckets.unavailable.length,
        },
      },
    };
  }

  // 2) availability bucket ordering second
  const chosenPool = buckets[bucket];

  // 3) trust/economic scoring third (reuse existing routing, preserves exploration)
  const routed = selectCandidateReputationAware({ candidates: chosenPool, topics: [cap], rng, dataDir });

  const id = safeStr(routed?.selected?.agent_id);
  const r = id && nodes[id] ? nodes[id] : null;
  const status = safeStr(r?.availability_status) || bucket;
  const reason = safeStr(r?.availability_reason) || `bucket:${bucket}`;

  return {
    ok: true,
    selected: routed.selected,
    reason: routed.reason,
    exploration_used: routed.exploration_used,
    routing: {
      availability_status: status,
      availability_bucket: bucket,
      availability_reason: reason,
      candidate_count: capFiltered.length,
      bucket_counts: {
        available: buckets.available.length,
        stale: buckets.stale.length,
        unknown: buckets.unknown.length,
        unavailable: buckets.unavailable.length,
      },
      inner: routed,
    },
  };
}
