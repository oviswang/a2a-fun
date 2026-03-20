import fs from 'node:fs';
import path from 'node:path';

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function getPaths({ dataDir } = {}) {
  const dir = dataDir || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'data');
  return {
    dataDir: dir,
    rewardLedger: path.join(dir, 'reward_ledger.jsonl'),
    valueLedger: path.join(dir, 'value_ledger.jsonl'),
    offerFeed: path.join(dir, 'offer_feed.jsonl'),
    earnings: path.join(dir, 'earnings_analytics.json')
  };
}

function readJsonlTail(p, maxLines = 200000) {
  try {
    const s = fs.readFileSync(p, 'utf8');
    const lines = s.split('\n').filter(Boolean);
    return lines.slice(-maxLines).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function idxBy(xs, keyFn) {
  const m = new Map();
  for (const x of xs) {
    const k = keyFn(x);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

function pickLatest(xs, tsKey = 'ts') {
  if (!Array.isArray(xs) || !xs.length) return null;
  const withT = xs.map((x) => {
    const t = Date.parse(String(x?.[tsKey] || ''));
    return { x, t: Number.isFinite(t) ? t : 0 };
  });
  withT.sort((a, b) => a.t - b.t);
  return withT[withT.length - 1].x;
}

function classifyTrace(trace) {
  // Completeness based on required chain segments.
  const offerFound = !!trace?.offer?.offer_id;
  const execFound = !!trace?.execution?.executed;
  const valueFound = !!trace?.value_event?.event_id;
  const rewardFound = !!trace?.reward_credit?.event_id;

  if (rewardFound && valueFound && execFound && offerFound) return { status: 'complete', breakpoint: null };

  if (rewardFound && !valueFound) return { status: 'missing_value', breakpoint: 'value' };
  if (valueFound && !rewardFound) return { status: 'missing_reward', breakpoint: 'reward' };
  if (offerFound && !execFound) return { status: 'missing_execution', breakpoint: 'execute' };
  if (!offerFound) return { status: 'missing_offer', breakpoint: 'offer' };

  return { status: 'partial_unknown', breakpoint: 'unknown' };
}

export function summarizeEconomicTrace(trace) {
  const cls = classifyTrace(trace);

  const out = {
    ok: true,
    summarized_at: nowIso(),
    status: cls.status,
    breakpoint: cls.breakpoint,
    trace_keys: {
      offer_id: trace?.offer?.offer_id || trace?.offer_id || null,
      task_id: trace?.task_id || trace?.offer?.task_id || trace?.value_event?.context?.task_id || trace?.reward_credit?.context?.task_id || null,
      winner_super_identity_id: trace?.winner_super_identity_id || trace?.reward_credit?.super_identity_id || trace?.value_event?.context?.winner_sid || null,
      source_super_identity_id: trace?.source_super_identity_id || trace?.reward_credit?.context?.source_super_identity_id || trace?.value_event?.context?.source_super_identity_id || null,
      value_event_id: trace?.value_event?.event_id || null,
      reward_event_id: trace?.reward_credit?.event_id || null
    },
    missing: []
  };

  if (cls.status !== 'complete') {
    if (!trace?.offer?.offer_id) out.missing.push('offer');
    if (!trace?.execution?.executed) out.missing.push('execute');
    if (!trace?.value_event?.event_id) out.missing.push('value_event');
    if (!trace?.reward_credit?.event_id) out.missing.push('reward_credit');
  }

  return out;
}

function buildIndexes({ dataDir } = {}) {
  const { rewardLedger, valueLedger, offerFeed, earnings } = getPaths({ dataDir });

  const rewardEvents = readJsonlTail(rewardLedger, 200000).filter((e) => e.event_type === 'reward_credit');
  const valueEvents = readJsonlTail(valueLedger, 200000).filter((e) => e.event_type === 'task_success');
  const offerEvents = readJsonlTail(offerFeed, 200000);
  const earningsDoc = (() => {
    try {
      const raw = fs.readFileSync(earnings, 'utf8');
      return JSON.parse(String(raw || ''));
    } catch {
      return null;
    }
  })();

  const valueById = new Map();
  for (const v of valueEvents) {
    if (typeof v?.event_id === 'string') valueById.set(v.event_id, v);
  }

  const rewardById = new Map();
  for (const r of rewardEvents) {
    if (typeof r?.event_id === 'string') rewardById.set(r.event_id, r);
  }

  const valueByOffer = idxBy(valueEvents, (v) => (typeof v?.context?.offer_id === 'string' ? v.context.offer_id : null));
  const rewardByOffer = idxBy(rewardEvents, (r) => (typeof r?.context?.offer_id === 'string' ? r.context.offer_id : null));
  const rewardByValueId = idxBy(rewardEvents, (r) => (typeof r?.context?.value_event_id === 'string' ? r.context.value_event_id : null));

  const offerById = new Map();
  // Preserve latest offer_created as canonical, but keep execution/accept signals too.
  const createdById = idxBy(offerEvents, (e) => (typeof e?.offer_id === 'string' && e.event_type === 'offer_created' ? e.offer_id : null));
  for (const [oid, xs] of createdById.entries()) offerById.set(oid, pickLatest(xs) || null);

  const execById = idxBy(offerEvents, (e) => (typeof e?.offer_id === 'string' && (e.event_type === 'offer_executed' || e.event_type === 'offer_execution_won' || e.event_type === 'offer_execution_lost') ? e.offer_id : null));
  const acceptById = idxBy(offerEvents, (e) => (typeof e?.offer_id === 'string' && (e.event_type === 'offer_accepted' || e.event_type === 'offer_rejected') ? e.offer_id : null));

  return {
    rewardEvents,
    valueEvents,
    offerEvents,
    earningsDoc,
    valueById,
    rewardById,
    valueByOffer,
    rewardByOffer,
    rewardByValueId,
    offerById,
    execById,
    acceptById
  };
}

export function traceEconomicPathByRewardEvent(reward_event_id, { dataDir, backfill } = {}) {
  const id = String(reward_event_id || '').trim();
  const idx = buildIndexes({ dataDir });

  const reward = idx.rewardById.get(id) || null;
  const ctx = isPlainObject(reward?.context) ? reward.context : {};

  const offer_id = typeof ctx.offer_id === 'string' ? ctx.offer_id : null;
  let value_event_id = typeof ctx.value_event_id === 'string' ? ctx.value_event_id : null;

  let inferred_links_used = false;
  let confidence = null;

  // Backfill assist (v0.6.9): fill missing linkage without rewriting ledgers.
  if (!value_event_id) {
    const inf = backfill?.inferred?.by_reward_event_id?.[id];
    const vid = inf?.linked_ids?.value_event_id;
    if (typeof vid === 'string' && vid.trim()) {
      value_event_id = vid.trim();
      inferred_links_used = true;
      confidence = inf?.confidence || 'medium';
    }
  }

  const value = value_event_id ? (idx.valueById.get(value_event_id) || null) : null;
  let offer = offer_id ? (idx.offerById.get(offer_id) || null) : null;
  const inferredOffer = offer_id && !offer ? backfill?.inferred?.by_offer_id?.[offer_id] : null;
  if (!offer && inferredOffer?.inferred === true) {
    offer = { offer_id, inferred: true, ...inferredOffer.linked_ids };
    inferred_links_used = true;
    confidence = confidence || inferredOffer.confidence || 'low';
  }

  const execSig = offer_id ? (pickLatest(idx.execById.get(offer_id) || []) || null) : null;
  const acceptSig = offer_id ? (pickLatest(idx.acceptById.get(offer_id) || []) || null) : null;

  const trace = {
    ok: true,
    traced_at: nowIso(),
    query: { mode: 'reward_event_id', reward_event_id: id },
    offer_id,
    task_id: typeof ctx.task_id === 'string' ? ctx.task_id : null,
    winner_super_identity_id: reward?.super_identity_id || null,
    source_super_identity_id: typeof ctx.source_super_identity_id === 'string' ? ctx.source_super_identity_id : null,
    offer,
    acceptance: {
      accepted: acceptSig?.event_type === 'offer_accepted' ? true : acceptSig?.event_type === 'offer_rejected' ? false : null,
      event: acceptSig
    },
    execution: {
      executed: execSig?.event_type === 'offer_executed' || execSig?.event_type === 'offer_execution_won' || execSig?.event_type === 'offer_execution_lost' ? true : false,
      event: execSig
    },
    value_event: value,
    reward_credit: reward,
    earnings_visibility: {
      has_earnings_analytics: !!idx.earningsDoc?.ok,
      sid_entry_present: !!idx.earningsDoc?.analytics?.[String(reward?.super_identity_id || '')]
    }
  };

  trace.summary = summarizeEconomicTrace(trace);
  trace.inferred_links_used = inferred_links_used;
  trace.confidence = inferred_links_used ? (confidence || 'medium') : 'high';
  trace.trace_status = trace.summary.status === 'complete'
    ? (inferred_links_used ? 'inferred_complete' : 'complete')
    : 'partial';

  return trace;
}

export function traceEconomicPathByValueEvent(value_event_id, { dataDir, backfill } = {}) {
  const id = String(value_event_id || '').trim();
  const idx = buildIndexes({ dataDir });

  let inferred_links_used = false;
  let confidence = null;

  const value = idx.valueById.get(id) || null;
  const offer_id = typeof value?.context?.offer_id === 'string' ? value.context.offer_id : null;
  const reward = pickLatest(idx.rewardByValueId.get(id) || []) || null;
  let offer = offer_id ? (idx.offerById.get(offer_id) || null) : null;
  const inferredOffer = offer_id && !offer ? backfill?.inferred?.by_offer_id?.[offer_id] : null;
  if (!offer && inferredOffer?.inferred === true) {
    offer = { offer_id, inferred: true, ...inferredOffer.linked_ids };
    inferred_links_used = true;
    confidence = inferredOffer.confidence || 'low';
  }

  const execSig = offer_id ? (pickLatest(idx.execById.get(offer_id) || []) || null) : null;
  const acceptSig = offer_id ? (pickLatest(idx.acceptById.get(offer_id) || []) || null) : null;

  const trace = {
    ok: true,
    traced_at: nowIso(),
    query: { mode: 'value_event_id', value_event_id: id },
    offer_id,
    task_id: typeof value?.context?.task_id === 'string' ? value.context.task_id : null,
    winner_super_identity_id: value?.context?.winner_sid || null,
    source_super_identity_id: value?.context?.source_super_identity_id || null,
    offer,
    acceptance: {
      accepted: acceptSig?.event_type === 'offer_accepted' ? true : acceptSig?.event_type === 'offer_rejected' ? false : null,
      event: acceptSig
    },
    execution: {
      executed: execSig?.event_type === 'offer_executed' || execSig?.event_type === 'offer_execution_won' || execSig?.event_type === 'offer_execution_lost' ? true : false,
      event: execSig
    },
    value_event: value,
    reward_credit: reward
  };

  trace.summary = summarizeEconomicTrace(trace);
  trace.inferred_links_used = inferred_links_used;
  trace.confidence = inferred_links_used ? (confidence || 'medium') : 'high';
  trace.trace_status = trace.summary.status === 'complete'
    ? (inferred_links_used ? 'inferred_complete' : 'complete')
    : 'partial';

  return trace;
}

export function traceEconomicPathByOffer(offer_id, { dataDir, backfill } = {}) {
  const oid = String(offer_id || '').trim();
  const idx = buildIndexes({ dataDir });

  let inferred_links_used = false;
  let confidence = null;

  let offer = idx.offerById.get(oid) || null;
  const inferredOffer = !offer ? backfill?.inferred?.by_offer_id?.[oid] : null;
  if (!offer && inferredOffer?.inferred === true) {
    offer = { offer_id: oid, inferred: true, ...inferredOffer.linked_ids };
    inferred_links_used = true;
    confidence = inferredOffer.confidence || 'low';
  }
  const execSig = pickLatest(idx.execById.get(oid) || []) || null;
  const acceptSig = pickLatest(idx.acceptById.get(oid) || []) || null;

  const values = idx.valueByOffer.get(oid) || [];
  const rewards = idx.rewardByOffer.get(oid) || [];

  // Prefer linkage via value_event_id when possible
  const value = pickLatest(values) || null;
  const reward = value?.event_id ? (pickLatest(idx.rewardByValueId.get(value.event_id) || []) || pickLatest(rewards) || null) : pickLatest(rewards) || null;

  const trace = {
    ok: true,
    traced_at: nowIso(),
    query: { mode: 'offer_id', offer_id: oid },
    offer_id: oid,
    task_id: typeof offer?.task_type === 'string' ? offer.task_type : null,
    winner_super_identity_id: reward?.super_identity_id || value?.context?.winner_sid || null,
    source_super_identity_id: value?.context?.source_super_identity_id || reward?.context?.source_super_identity_id || null,
    offer,
    acceptance: {
      accepted: acceptSig?.event_type === 'offer_accepted' ? true : acceptSig?.event_type === 'offer_rejected' ? false : null,
      event: acceptSig
    },
    execution: {
      executed: execSig?.event_type === 'offer_executed' || execSig?.event_type === 'offer_execution_won' || execSig?.event_type === 'offer_execution_lost' ? true : false,
      event: execSig
    },
    value_event: value,
    reward_credit: reward,
    notes: {
      value_events_seen: values.length,
      reward_credits_seen: rewards.length
    }
  };

  trace.summary = summarizeEconomicTrace(trace);
  trace.inferred_links_used = inferred_links_used;
  trace.confidence = inferred_links_used ? (confidence || 'medium') : 'high';
  trace.trace_status = trace.summary.status === 'complete'
    ? (inferred_links_used ? 'inferred_complete' : 'complete')
    : 'partial';

  return trace;
}
