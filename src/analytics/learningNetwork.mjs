import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_BYTES = 2048;

function nowIso() {
  return new Date().toISOString();
}

function truncateString(s, maxBytes) {
  const str = String(s ?? '');
  const buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxBytes) return str;
  return buf.subarray(0, maxBytes - 3).toString('utf8') + '...';
}

function safeJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return '{}';
  }
}

function truncateEvent(e0) {
  const e = structuredClone(e0);
  if (e?.context?.reason) e.context.reason = truncateString(e.context.reason, 1024);
  let line = safeJson(e);
  if (Buffer.byteLength(line, 'utf8') <= MAX_BYTES) return e;

  // reduce context if too large
  if (e.context && typeof e.context === 'object') {
    e.context = {
      linked_strategy_timeline_event_id: e.context.linked_strategy_timeline_event_id ?? null,
      local_strategy_type_before: e.context.local_strategy_type_before ?? null,
      suggested_adjustment: e.context.suggested_adjustment ?? null,
      reason: e.context.reason ? truncateString(e.context.reason, 256) : null
    };
  }

  line = safeJson(e);
  if (Buffer.byteLength(line, 'utf8') <= MAX_BYTES) return e;

  if (e.context) e.context.reason = '[truncated]';
  return e;
}

function getPaths({ dataDir } = {}) {
  const dir = dataDir || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'data');
  return {
    dataDir: dir,
    ledger: path.join(dir, 'learning_network.jsonl'),
    insights: path.join(dir, 'learning_insights.json')
  };
}

async function appendLine(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.appendFile(p, JSON.stringify(obj) + '\n', 'utf8');
}

export async function appendImitationReference({
  super_identity_id,
  source,
  context,
  event_id
} = {}, { dataDir } = {}) {
  const { ledger } = getPaths({ dataDir });
  const eid = String(event_id || `evt-${crypto.randomUUID()}`);
  const event = truncateEvent({
    event_id: eid,
    ts: nowIso(),
    super_identity_id,
    event_type: 'imitation_reference',
    source,
    context
  });

  try {
    await appendLine(ledger, event);
    return { ok: true, event_id: eid };
  } catch {
    return { ok: false, event_id: eid };
  }
}

export async function appendImitationEvaluation({
  super_identity_id,
  linked_event_id,
  result,
  before_reward,
  after_reward,
  decision,
  context,
  event_id
} = {}, { dataDir } = {}) {
  const { ledger } = getPaths({ dataDir });
  const eid = String(event_id || `evt-${crypto.randomUUID()}`);
  const event = truncateEvent({
    event_id: eid,
    ts: nowIso(),
    super_identity_id,
    event_type: 'imitation_evaluation',
    linked_event_id,
    result,
    before_reward,
    after_reward,
    decision,
    context
  });

  try {
    await appendLine(ledger, event);
    return { ok: true, event_id: eid };
  } catch {
    return { ok: false, event_id: eid };
  }
}

export async function readLearningLedger({ dataDir } = {}) {
  const { ledger } = getPaths({ dataDir });
  try {
    const raw = await fs.readFile(ledger, 'utf8');
    return raw.split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

export async function rebuildLearningInsights({ dataDir } = {}) {
  const { insights } = getPaths({ dataDir });
  const events = await readLearningLedger({ dataDir });

  const perSid = {};
  const byStrategyType = {};
  const edges = {}; // sid -> strategy_type counts (or sid->sid if available)

  const bump = (obj, k, d = 1) => {
    obj[k] = (obj[k] || 0) + d;
  };

  for (const e of events) {
    const sid = e.super_identity_id;
    if (!sid) continue;
    if (!perSid[sid]) {
      perSid[sid] = {
        imitation_count: 0,
        imitation_improved_count: 0,
        imitation_flat_count: 0,
        imitation_degraded_count: 0,
        avg_reward_delta_after_imitation: 0,
        _deltas: []
      };
    }

    if (e.event_type === 'imitation_reference') {
      perSid[sid].imitation_count++;
      const st = String(e?.source?.candidate_strategy_type || 'unknown');
      bump(byStrategyType, st, 1);

      const refSid = e?.source?.candidate_reference_sid;
      if (refSid) {
        const key = `${sid}→${refSid}`;
        bump(edges, key, 1);
      } else {
        const key = `${sid}→type:${st}`;
        bump(edges, key, 1);
      }
    }

    if (e.event_type === 'imitation_evaluation') {
      if (e.result === 'improved') perSid[sid].imitation_improved_count++;
      else if (e.result === 'degraded') perSid[sid].imitation_degraded_count++;
      else perSid[sid].imitation_flat_count++;

      const d = Number(e?.context?.reward_delta);
      if (Number.isFinite(d)) perSid[sid]._deltas.push(d);

      const st = String(e?.context?.candidate_strategy_type || 'unknown');
      if (!byStrategyType[st]) byStrategyType[st] = 0;
    }
  }

  for (const [sid, s] of Object.entries(perSid)) {
    const totalEval = s.imitation_improved_count + s.imitation_flat_count + s.imitation_degraded_count;
    s.imitation_success_rate = totalEval > 0 ? s.imitation_improved_count / totalEval : 0;
    s.avg_reward_delta_after_imitation = s._deltas.length ? (s._deltas.reduce((a, b) => a + b, 0) / s._deltas.length) : 0;
    delete s._deltas;
  }

  const global = {
    total_references: events.filter((e) => e.event_type === 'imitation_reference').length,
    total_evaluations: events.filter((e) => e.event_type === 'imitation_evaluation').length,
    strategy_type_imitated_counts: byStrategyType,
    edges
  };

  const out = { ok: true, updated_at: nowIso(), per_sid: perSid, global };
  await fs.mkdir(path.dirname(insights), { recursive: true });
  await fs.writeFile(insights, JSON.stringify(out, null, 2) + '\n', 'utf8').catch(() => {});
  return out;
}
