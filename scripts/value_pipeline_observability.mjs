#!/usr/bin/env node

// v0.6.7: Value Pipeline Integrity observability (derived-only)
// Contract: offer → accept → execute → value_event → reward_credit

import fs from 'node:fs/promises';
import path from 'node:path';

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function readJsonl(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return raw.split('\n').filter(Boolean).map(safeJsonParse).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeOfferId(x) {
  return typeof x === 'string' && x.trim() ? x.trim() : null;
}

function parseArgs(argv) {
  const out = { human: false, writeCache: false, offerId: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--human') out.human = true;
    else if (a === '--write-cache') out.writeCache = true;
    else if (a === '--offer') out.offerId = String(argv[++i] || '').trim() || null;
  }
  return out;
}

function classifyBreakpoint({ executed, valueEvent, rewardCredit, rewardMissingLink, hasDuplicateValue, hasDuplicateReward }) {
  if (!executed) return { breakpoint: 'execute', reason: 'no_execution' };
  if (!valueEvent) return { breakpoint: 'value', reason: 'missing_value_event' };
  if (hasDuplicateValue) return { breakpoint: 'duplicate_guard', reason: 'multiple_value_events' };

  const v = Number(valueEvent.value || 0);
  const vr = String(valueEvent?.context?.value_reason || '');
  if (v <= 0) return { breakpoint: 'zero_value_rule', reason: vr || 'value_zero' };

  if (!rewardCredit && rewardMissingLink) return { breakpoint: 'reward', reason: 'reward_credit_missing_value_link' };
  if (!rewardCredit) return { breakpoint: 'reward', reason: 'missing_reward_credit_for_positive_value' };
  if (hasDuplicateReward) return { breakpoint: 'duplicate_guard', reason: 'multiple_reward_credits' };

  return { breakpoint: null, reason: 'ok' };
}

async function main() {
  const args = parseArgs(process.argv);
  const ws = process.env.A2A_WORKSPACE_PATH ? String(process.env.A2A_WORKSPACE_PATH).trim() : process.cwd();

  const offerFeed = await readJsonl(path.join(ws, 'data', 'offer_feed.jsonl'));
  const valueLedger = await readJsonl(path.join(ws, 'data', 'value_ledger.jsonl'));
  const rewardLedger = await readJsonl(path.join(ws, 'data', 'reward_ledger.jsonl'));

  // executed offers (best-effort): prefer offer_executed, fall back to offer_execution_won
  const executedOffers = new Map();
  for (const e of offerFeed) {
    const oid = normalizeOfferId(e.offer_id);
    if (!oid) continue;
    if (e.event_type === 'offer_executed' || e.event_type === 'offer_execution_won') {
      executedOffers.set(oid, e);
    }
  }

  const valueByOffer = new Map();
  for (const e of valueLedger) {
    if (e?.event_type !== 'task_success') continue;
    const oid = normalizeOfferId(e?.context?.offer_id);
    if (!oid) continue;
    const xs = valueByOffer.get(oid) || [];
    xs.push(e);
    valueByOffer.set(oid, xs);
  }

  const rewardByOffer = new Map();
  for (const e of rewardLedger) {
    if (e?.event_type !== 'reward_credit') continue;
    const oid = normalizeOfferId(e?.context?.offer_id);
    if (!oid) continue;
    const xs = rewardByOffer.get(oid) || [];
    xs.push(e);
    rewardByOffer.set(oid, xs);
  }

  const rows = [];
  const unionIds = new Set([...
    executedOffers.keys(),
    ...valueByOffer.keys(),
    ...rewardByOffer.keys()
  ]);
  const offerIds = args.offerId ? [args.offerId] : [...unionIds];

  for (const oid of offerIds) {
    const executed = executedOffers.get(oid) || null;
    const vs = valueByOffer.get(oid) || [];
    const rs = rewardByOffer.get(oid) || [];

    const valueEvent = vs[vs.length - 1] || null;
    const rewardCredit = rs.find((x) => x?.context?.value_event_id) || null;
    const rewardMissingLink = rs.find((x) => !x?.context?.value_event_id) || null;

    const hasDuplicateValue = vs.length > 1;
    const hasDuplicateReward = rs.length > 1;

    const cls = classifyBreakpoint({
      executed: !!executed,
      valueEvent,
      rewardCredit,
      rewardMissingLink,
      hasDuplicateValue,
      hasDuplicateReward
    });

    rows.push({
      offer_id: oid,
      executed: !!executed,
      expected_value: Number(executed?.expected_value || 0),
      value_emitted: !!valueEvent,
      value_event_id: valueEvent?.event_id || null,
      value: Number(valueEvent?.value || 0),
      value_reason: valueEvent?.context?.value_reason || null,
      reward_linked: !!rewardCredit,
      reward_missing_link: !!rewardMissingLink,
      reward_event_id: rewardCredit?.event_id || rewardMissingLink?.event_id || null,
      reward_amount: rewardCredit ? Number(rewardCredit.amount || 0) : rewardMissingLink ? Number(rewardMissingLink.amount || 0) : 0,
      breakpoint: cls.breakpoint,
      breakpoint_reason: cls.reason,
      duplicates: { value_events: vs.length, reward_credits: rs.length }
    });
  }

  const executed_count = rows.filter((r) => r.executed).length;
  const value_emitted_count = rows.filter((r) => r.value_emitted).length;
  const value_missing_count = rows.filter((r) => r.executed && !r.value_emitted).length;
  const reward_linked_count = rows.filter((r) => r.reward_linked).length;
  const missing_link_count = rows.filter((r) => r.reward_missing_link).length;

  const breakpoints = {};
  for (const r of rows) {
    const k = r.breakpoint || 'ok';
    breakpoints[k] = (breakpoints[k] || 0) + 1;
  }
  const most_common_breakpoint = Object.entries(breakpoints).sort((a, b) => b[1] - a[1])[0]?.[0] || 'ok';

  const report = {
    ok: true,
    generated_at: nowIso(),
    executed_count,
    value_emitted_count,
    value_missing_count,
    reward_linked_count,
    missing_link_count,
    most_common_breakpoint,
    breakpoints,
    sample: rows.slice(-50)
  };

  if (args.writeCache) {
    const outPath = path.join(ws, 'data', 'value_pipeline_integrity.json');
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
  }

  if (!args.human) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }

  const lines = [
    'Value Pipeline Observability (v0.6.7)',
    `- generated_at: ${report.generated_at}`,
    `- executed_count: ${executed_count}`,
    `- value_emitted_count: ${value_emitted_count}`,
    `- value_missing_count: ${value_missing_count}`,
    `- reward_linked_count: ${reward_linked_count}`,
    `- missing_link_count: ${missing_link_count}`,
    `- most_common_breakpoint: ${most_common_breakpoint}`,
    'Breakpoints:',
    ...Object.entries(breakpoints).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`)
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + '\n');
  process.exit(1);
});
