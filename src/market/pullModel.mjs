import fs from 'node:fs';
import path from 'node:path';

import { appendOfferFeedEvent, rebuildMarketMetrics } from './offerFeed.mjs';
import { shouldAcceptOffer } from './offerDecision.mjs';
import { emitValueForTaskSuccess, getValue } from '../value/value.mjs';
import { emitReputationEvent } from '../reputation/reputation.mjs';
import { creditReward } from '../reward/reward.mjs';

function nowIso() {
  return new Date().toISOString();
}

function num(x, dflt) {
  const n = Number(x);
  return Number.isFinite(n) ? n : dflt;
}

function readFeedTail({ dataDir, maxLines = 8000 } = {}) {
  const dir = dataDir || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'data');
  const feedPath = path.join(dir, 'offer_feed.jsonl');
  let lines = [];
  try {
    const s = fs.readFileSync(feedPath, 'utf8');
    lines = s.split('\n').filter(Boolean).slice(-maxLines);
  } catch {
    lines = [];
  }
  return { feedPath, lines };
}

function earliestExecutedEvent({ offer_id, dataDir } = {}) {
  const { lines } = readFeedTail({ dataDir, maxLines: 12000 });
  let best = null;
  for (const line of lines) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e?.offer_id !== offer_id) continue;
    if (e?.event_type !== 'offer_executed') continue;
    if (!best || String(e.ts) < String(best.ts)) best = e;
  }
  return best;
}

/**
 * Discover recent offers from offer_feed.jsonl.
 * Returns latest state per offer_id.
 */
export function discoverRecentOffers({ limit = 50, minExpectedValue = null, includeExecuted = false, dataDir } = {}) {
  // rebuildMarketMetrics is safe and ensures metrics file exists (optional)
  try {
    rebuildMarketMetrics({ dataDir });
  } catch {}

  const { feedPath, lines } = readFeedTail({ dataDir, maxLines: 5000 });

  const byOffer = new Map();
  const executed = new Set();

  for (const line of lines) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e.offer_id) continue;

    if (e.event_type === 'offer_executed') executed.add(e.offer_id);

    const prev = byOffer.get(e.offer_id);
    if (!prev || String(e.ts) > String(prev.ts)) byOffer.set(e.offer_id, e);
  }

  let offers = [...byOffer.values()].map((e) => ({
    offer_id: e.offer_id,
    task_type: e.task_type,
    expected_value: e.expected_value ?? 1,
    source_super_identity_id: e.source_super_identity_id || null,
    latest_event_type: e.event_type,
    latest_ts: e.ts,
    reason: e.reason || null,
    executed: executed.has(e.offer_id)
  }));

  if (!includeExecuted) offers = offers.filter((o) => !o.executed);
  if (minExpectedValue !== null) offers = offers.filter((o) => num(o.expected_value, 1) >= num(minExpectedValue, 0));

  offers.sort((a, b) => String(b.latest_ts).localeCompare(String(a.latest_ts)));
  offers = offers.slice(0, Math.max(1, num(limit, 50)));

  try {
    process.stdout.write(`${JSON.stringify({ ok: true, event: 'OFFER_DISCOVERED', ts: nowIso(), count: offers.length })}\n`);
  } catch {}

  return { ok: true, offers, feedPath };
}

export function emitInterestSignal({ offer_id, node_id, super_identity_id, dataDir } = {}) {
  const out = appendOfferFeedEvent(
    {
      offer_id,
      event_type: 'offer_interest',
      target_node_id: node_id || null,
      target_super_identity_id: super_identity_id || null,
      metadata: {}
    },
    { dataDir }
  );

  try {
    process.stdout.write(`${JSON.stringify({ ok: true, event: 'OFFER_INTEREST', ts: nowIso(), offer_id, node_id, super_identity_id })}\n`);
  } catch {}

  return out;
}

/**
 * attemptPickupOffers()
 * - discovers offers
 * - filters viable
 * - tries accept + execute (max attempts per cycle)
 */
export async function attemptPickupOffers({
  node_id,
  node_super_identity_id,
  maxAttemptsPerCycle = 3,
  minExpectedValue = null,
  dataDir,
  beforeFinalizeHook
} = {}) {
  const disc = await discoverRecentOffers({ limit: 200, minExpectedValue, includeExecuted: false, dataDir });
  if (!disc.ok) return disc;

  const offers = disc.offers;
  const max = Math.max(1, num(maxAttemptsPerCycle, 3));

  let tried = 0;
  for (const o of offers) {
    if (tried >= max) break;
    tried++;

    try {
      process.stdout.write(`${JSON.stringify({ ok: true, event: 'OFFER_PICKUP_ATTEMPT', ts: nowIso(), offer_id: o.offer_id, expected_value: o.expected_value })}\n`);
    } catch {}

    // Optional interest signal
    emitInterestSignal({ offer_id: o.offer_id, node_id, super_identity_id: node_super_identity_id, dataDir });

    // Duplicate safety: skip if executed already (double-check)
    if (o.executed) {
      try {
        process.stdout.write(`${JSON.stringify({ ok: true, event: 'OFFER_PICKUP_SKIPPED', ts: nowIso(), offer_id: o.offer_id, reason: 'already_executed' })}\n`);
      } catch {}
      continue;
    }

    // Adapt offer to decision function
    const offer = {
      offer_id: o.offer_id,
      task_type: o.task_type,
      expected_value: o.expected_value
    };

    const decision = shouldAcceptOffer(offer, { node_id, dataDir, reputation_score: 0 });
    if (!decision.accepted) {
      try {
        process.stdout.write(`${JSON.stringify({ ok: true, event: 'OFFER_PICKUP_SKIPPED', ts: nowIso(), offer_id: o.offer_id, reason: decision.reason })}\n`);
      } catch {}
      continue;
    }

    // Lightweight competition:
    // 1) log execution attempt
    appendOfferFeedEvent(
      {
        offer_id: o.offer_id,
        event_type: 'offer_execution_attempt',
        task_type: o.task_type,
        expected_value: o.expected_value,
        source_super_identity_id: o.source_super_identity_id,
        target_node_id: node_id || null,
        target_super_identity_id: node_super_identity_id || null,
        metadata: { pickup: true }
      },
      { dataDir }
    );
    try {
      process.stdout.write(`${JSON.stringify({ ok: true, event: 'OFFER_EXECUTION_ATTEMPT', ts: nowIso(), offer_id: o.offer_id, node_id })}\n`);
    } catch {}

    // 2) Win condition check BEFORE finalizing.
    if (typeof beforeFinalizeHook === 'function') {
      try {
        await beforeFinalizeHook({ offer_id: o.offer_id });
      } catch {}
    }
    const existing = earliestExecutedEvent({ offer_id: o.offer_id, dataDir });
    if (existing) {
      appendOfferFeedEvent(
        {
          offer_id: o.offer_id,
          event_type: 'offer_execution_lost',
          task_type: o.task_type,
          expected_value: o.expected_value,
          source_super_identity_id: o.source_super_identity_id,
          target_node_id: node_id || null,
          target_super_identity_id: node_super_identity_id || null,
          reason: 'already_executed',
          metadata: { winner_ts: existing.ts }
        },
        { dataDir }
      );
      try {
        process.stdout.write(`${JSON.stringify({ ok: true, event: 'OFFER_EXECUTION_LOST', ts: nowIso(), offer_id: o.offer_id, reason: 'already_executed' })}\n`);
      } catch {}

      // reputation feedback (lightweight)
      try {
        if (typeof node_super_identity_id === 'string' && node_super_identity_id.startsWith('sid-')) {
          emitReputationEvent({
            super_identity_id: node_super_identity_id,
            event_type: 'competition_loss',
            source: { type: 'system' },
            context: { task: o.task_type, channel: 'pull', meta: { offer_id: o.offer_id, reason: 'already_executed' } }
          }, { dataDir });
        }
      } catch {}

      continue;
    }

    // 3) Append offer_executed (race-safe: multiple may append; earliest ts wins)
    const execEv = appendOfferFeedEvent(
      {
        offer_id: o.offer_id,
        event_type: 'offer_executed',
        task_type: o.task_type,
        expected_value: o.expected_value,
        source_super_identity_id: o.source_super_identity_id,
        target_node_id: node_id || null,
        target_super_identity_id: node_super_identity_id || null,
        metadata: { pickup: true }
      },
      { dataDir }
    );

    const earliest = earliestExecutedEvent({ offer_id: o.offer_id, dataDir });
    const iAmWinner = earliest && execEv?.event && earliest.event_id === execEv.event.event_id;

    if (!iAmWinner) {
      appendOfferFeedEvent(
        {
          offer_id: o.offer_id,
          event_type: 'offer_execution_lost',
          task_type: o.task_type,
          expected_value: o.expected_value,
          source_super_identity_id: o.source_super_identity_id,
          target_node_id: node_id || null,
          target_super_identity_id: node_super_identity_id || null,
          reason: 'race_lost',
          metadata: { earliest_ts: earliest?.ts || null }
        },
        { dataDir }
      );
      try {
        process.stdout.write(`${JSON.stringify({ ok: true, event: 'OFFER_EXECUTION_LOST', ts: nowIso(), offer_id: o.offer_id, reason: 'race_lost' })}\n`);
      } catch {}

      try {
        if (typeof node_super_identity_id === 'string' && node_super_identity_id.startsWith('sid-')) {
          emitReputationEvent({
            super_identity_id: node_super_identity_id,
            event_type: 'competition_loss',
            source: { type: 'system' },
            context: { task: o.task_type, channel: 'pull', meta: { offer_id: o.offer_id, reason: 'race_lost' } }
          }, { dataDir });
        }
      } catch {}

      continue;
    }

    // 4) Winner handling: write value ledger ONLY for winner
    appendOfferFeedEvent(
      {
        offer_id: o.offer_id,
        event_type: 'offer_execution_won',
        task_type: o.task_type,
        expected_value: o.expected_value,
        source_super_identity_id: o.source_super_identity_id,
        target_node_id: node_id || null,
        target_super_identity_id: node_super_identity_id || null
      },
      { dataDir }
    );

    // reputation feedback (lightweight)
    try {
      if (typeof node_super_identity_id === 'string' && node_super_identity_id.startsWith('sid-')) {
        emitReputationEvent({
          super_identity_id: node_super_identity_id,
          event_type: 'competition_win',
          source: { type: 'system' },
          context: { task: o.task_type, channel: 'pull', meta: { offer_id: o.offer_id } }
        }, { dataDir });
      }
    } catch {}

    const targetSid = o.source_super_identity_id;
    let valueOut = null;
    if (typeof targetSid === 'string' && targetSid.startsWith('sid-')) {
      valueOut = emitValueForTaskSuccess({
        super_identity_id: targetSid,
        context: { source_sid: 'system', expected_value: o.expected_value, offer_id: o.offer_id, task_type: o.task_type },
        dataDir
      });
    }

    // Settlement/reward realization: credit winner (node_super_identity_id) by FINAL value amount (>0), once.
    try {
      const winnerSid = node_super_identity_id;
      const amt = valueOut?.event?.value;
      if (typeof winnerSid === 'string' && winnerSid.startsWith('sid-') && Number(amt) > 0) {
        creditReward(
          {
            super_identity_id: winnerSid,
            amount: Number(amt),
            context: {
              offer_id: o.offer_id,
              task_id: o.task_type,
              value_event_id: valueOut?.event?.event_id || null,
              source_super_identity_id: targetSid,
              metadata: { pickup: true, channel: 'pull' }
            }
          },
          { dataDir }
        );
      }
    } catch {}

    try {
      process.stdout.write(`${JSON.stringify({ ok: true, event: 'OFFER_EXECUTION_WON', ts: nowIso(), offer_id: o.offer_id })}\n`);
    } catch {}

    try {
      process.stdout.write(`${JSON.stringify({ ok: true, event: 'OFFER_PICKUP_SUCCESS', ts: nowIso(), offer_id: o.offer_id })}\n`);
    } catch {}

    return { ok: true, picked: true, offer_id: o.offer_id };
  }

  return { ok: true, picked: false, tried };
}

export async function pollPickupLoop({ intervalMs = 15000, signal, ...params } = {}) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  while (!signal?.aborted) {
    await attemptPickupOffers(params);
    await wait(num(intervalMs, 15000));
  }
  return { ok: true, stopped: true };
}
