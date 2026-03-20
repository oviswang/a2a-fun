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
    outBackfill: path.join(dir, 'trace_backfill.json'),
    outCompleteness: path.join(dir, 'trace_completeness.json')
  };
}

function readJsonlTail(p, maxLines = 50000) {
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

function atomicWriteJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

function parseTs(iso) {
  const t = Date.parse(String(iso || ''));
  return Number.isFinite(t) ? t : null;
}

function pickClosestByTs(xs, targetTs) {
  if (!Array.isArray(xs) || !xs.length || targetTs === null) return null;
  let best = null;
  let bestD = Infinity;
  for (const x of xs) {
    const t = parseTs(x?.ts);
    if (t === null) continue;
    const d = Math.abs(t - targetTs);
    if (d < bestD) {
      bestD = d;
      best = x;
    }
  }
  return best;
}

export function runTraceBackfill({ dataDir, windowHours = 24, maxEvents = 2000 } = {}) {
  const { rewardLedger, valueLedger, offerFeed, outBackfill, outCompleteness } = getPaths({ dataDir });
  const now = Date.now();
  const windowMs = Number(windowHours) * 3600_000;

  const rewards = readJsonlTail(rewardLedger, 200000).filter((e) => e?.event_type === 'reward_credit');
  const values = readJsonlTail(valueLedger, 200000).filter((e) => e?.event_type === 'task_success');
  const offers = readJsonlTail(offerFeed, 200000);

  const recentRewards = rewards.filter((e) => {
    const t = parseTs(e?.ts);
    return t !== null && now - t <= windowMs;
  }).slice(-maxEvents);

  const offerCreatedById = new Map();
  for (const e of offers) {
    if (e?.event_type !== 'offer_created') continue;
    if (typeof e?.offer_id !== 'string') continue;
    offerCreatedById.set(e.offer_id, e);
  }

  const valuesByOffer = new Map();
  for (const v of values) {
    const oid = typeof v?.context?.offer_id === 'string' ? v.context.offer_id : null;
    if (!oid) continue;
    if (!valuesByOffer.has(oid)) valuesByOffer.set(oid, []);
    valuesByOffer.get(oid).push(v);
  }

  const inferred = {
    by_reward_event_id: {},
    by_offer_id: {},
    by_value_event_id: {}
  };

  let applied = 0;
  let skipped = 0;

  for (const r of recentRewards) {
    const rid = typeof r?.event_id === 'string' ? r.event_id : null;
    if (!rid) continue;

    const ctx = isPlainObject(r.context) ? r.context : {};
    const offer_id = typeof ctx.offer_id === 'string' ? ctx.offer_id : null;
    const value_event_id = typeof ctx.value_event_id === 'string' ? ctx.value_event_id : null;
    const task_id = typeof ctx.task_id === 'string' ? ctx.task_id : null;

    // CASE B — missing value_event_id: infer from same offer_id + closest timestamp + same winner_sid when available
    if (offer_id && !value_event_id) {
      const candidates = (valuesByOffer.get(offer_id) || []).filter((v) => {
        const wsid = v?.context?.winner_super_identity_id || v?.context?.winner_sid || null;
        return wsid ? String(wsid) === String(r.super_identity_id || '') : true;
      });
      const pick = pickClosestByTs(candidates, parseTs(r.ts));
      if (pick?.event_id) {
        inferred.by_reward_event_id[rid] = {
          inferred: true,
          confidence: 'high',
          inference_method: 'reward_missing_value_event_id:match_offer_id+winner+closest_ts',
          linked_ids: {
            reward_event_id: rid,
            value_event_id: pick.event_id,
            offer_id
          }
        };
        applied++;
      } else {
        skipped++;
      }
    }

    // CASE A — missing offer record: create inferred offer stub if offer_created missing but we have offer_id
    if (offer_id && !offerCreatedById.has(offer_id)) {
      const v = (valuesByOffer.get(offer_id) || [])[0] || null;
      inferred.by_offer_id[offer_id] = {
        inferred: true,
        confidence: v ? 'medium' : 'low',
        inference_method: v ? 'missing_offer:from_value_event_context' : 'missing_offer:from_reward_context_only',
        linked_ids: {
          offer_id,
          task_id: (v?.context?.task_id || task_id || null),
          expected_value: v?.context?.expected_value ?? null,
          source_super_identity_id: v?.context?.source_super_identity_id || ctx.source_super_identity_id || null,
          winner_super_identity_id: (v?.context?.winner_super_identity_id || r.super_identity_id || null)
        }
      };
      applied++;
    }

    // CASE C — missing task_id on reward: infer from value event if we have value_event_id
    if (!task_id && value_event_id) {
      const v = values.find((x) => x?.event_id === value_event_id) || null;
      if (v?.context?.task_id) {
        inferred.by_reward_event_id[rid] = {
          ...(inferred.by_reward_event_id[rid] || { inferred: true, confidence: 'medium', inference_method: 'reward_missing_task_id:from_value_event', linked_ids: { reward_event_id: rid } }),
          linked_ids: {
            ...(inferred.by_reward_event_id[rid]?.linked_ids || { reward_event_id: rid }),
            task_id: v.context.task_id
          }
        };
        applied++;
      }
    }
  }

  const out = {
    ok: true,
    updated_at: nowIso(),
    window_hours: windowHours,
    stats: { applied, skipped },
    inferred
  };

  atomicWriteJson(outBackfill, out);

  // Completeness metrics (reward-centric): classify recent rewards before/after backfill
  let total_traces = 0;
  let complete_traces = 0;
  let inferred_complete_traces = 0;
  let broken_traces = 0;

  for (const r of recentRewards) {
    total_traces++;
    const ctx = isPlainObject(r.context) ? r.context : {};
    const offer_id = typeof ctx.offer_id === 'string' ? ctx.offer_id : null;
    const value_event_id = typeof ctx.value_event_id === 'string' ? ctx.value_event_id : null;

    const offerOk = !!(offer_id && offerCreatedById.has(offer_id));
    const valueOk = !!value_event_id;

    const inferredValue = (!value_event_id && out.inferred.by_reward_event_id[r.event_id]?.linked_ids?.value_event_id) ? true : false;
    const inferredOffer = (!!offer_id && !offerOk && out.inferred.by_offer_id[offer_id]) ? true : false;

    const afterOfferOk = offerOk || inferredOffer;
    const afterValueOk = valueOk || inferredValue;

    if (offerOk && valueOk) complete_traces++;
    else if (afterOfferOk && afterValueOk) inferred_complete_traces++;
    else broken_traces++;
  }

  const missing_offer_ratio = total_traces ? (broken_traces / total_traces) : 0;
  const out2 = {
    ok: true,
    updated_at: nowIso(),
    window_hours: windowHours,
    total_traces,
    complete_traces,
    inferred_complete_traces,
    broken_traces,
    missing_offer_ratio,
    missing_value_ratio: null,
    missing_reward_ratio: null
  };

  atomicWriteJson(outCompleteness, out2);

  return { ok: true, backfill_path: outBackfill, completeness_path: outCompleteness, out: out, completeness: out2 };
}
