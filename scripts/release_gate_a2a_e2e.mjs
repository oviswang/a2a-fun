#!/usr/bin/env node

// Release Gate — A2A End-to-End Experience Check
// Evidence-first: writes a checkpoint directory with JSON artifacts.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

import { getNetworkSnapshot } from '../src/runtime/network/networkSnapshotV0_1.mjs';
import { updateResponderRegistry, loadResponderRegistry } from '../src/sidecar/responderRegistryV0_8_4.mjs';
import { appendOfferFeedEvent } from '../src/market/offerFeed.mjs';
import { emitValueForTaskSuccess } from '../src/value/value.mjs';
import { creditReward } from '../src/reward/reward.mjs';
import { traceEconomicPathByRewardEvent, summarizeEconomicTrace } from '../src/analytics/economicTrace.mjs';

function nowIso() { return new Date().toISOString(); }

function argVal(name, dflt = null) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return dflt;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function writeJson(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

async function appendJsonl(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.appendFile(p, JSON.stringify(obj) + '\n', 'utf8');
}

async function postJson(url, body, timeoutMs = 5000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), Math.max(200, timeoutMs));
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const j = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, json: j };
  } catch (e) {
    return { ok: false, status: 0, json: null, error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function safeStr(s) { return typeof s === 'string' ? s.trim() : ''; }

function requireSid(x, fallback) {
  const v = safeStr(x) || fallback;
  if (!v.startsWith('sid-')) return fallback;
  return v;
}

async function main() {
  const runs = Number(argVal('--runs', process.env.A2A_GATE_RUNS || '10')) || 10;
  const sidecarBase = safeStr(argVal('--sidecar', process.env.A2A_SIDECAR_URL || 'http://127.0.0.1:17890')).replace(/\/$/, '');
  const sidecarUrl = sidecarBase + '/a2a/request';

  const dataDir = safeStr(argVal('--dataDir', process.env.A2A_DATA_DIR || path.join(process.cwd(), 'data')));

  const outDir = safeStr(argVal('--out', '')) || path.join(process.cwd(), 'checkpoints', String(Date.now()));

  const sourceSid = requireSid(process.env.A2A_GATE_SOURCE_SID, 'sid-gate-source');
  const winnerSid = requireSid(process.env.A2A_GATE_WINNER_SID, 'sid-gate-winner');

  const evidence = {
    ok: true,
    started_at: nowIso(),
    params: { runs, sidecarUrl, dataDir, outDir, sourceSid, winnerSid },
    steps: {},
    metrics: {},
    failures: [],
  };

  // STEP 1 — Installability (best-effort; only if openclaw exists)
  try {
    const txt = execSync('openclaw plugins list --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const j = JSON.parse(txt.split('\n').slice(1).join('\n')); // drop possible prefix
    const a2a = Array.isArray(j?.plugins) ? j.plugins.find((p) => p.id === 'a2a-request') : null;
    evidence.steps.plugin = {
      ok: !!(a2a && a2a.status === 'loaded' && Array.isArray(a2a.toolNames) && a2a.toolNames.includes('a2a_request')),
      plugin: a2a || null,
    };
    if (!evidence.steps.plugin.ok) evidence.failures.push({ step: 'plugin', reason: 'a2a-request plugin not loaded or tool missing' });
  } catch {
    evidence.steps.plugin = { ok: null, skipped: true, reason: 'openclaw not available in this environment' };
  }

  // STEP 2 — Join network signal
  const snap = await getNetworkSnapshot({ bootstrap_timeout_ms: 1200 }).catch((e) => ({ ok: false, error: String(e?.message || e) }));
  evidence.steps.network_snapshot = snap;

  // STEP 3 — Responder discovery / registry
  const upd = await updateResponderRegistry({ dataDir }).catch((e) => ({ ok: false, error: String(e?.message || e) }));
  const reg = await loadResponderRegistry({ dataDir }).catch(() => ({ ok: false, registry: { ts: nowIso(), nodes: {} } }));

  const nodes = reg?.registry?.nodes && typeof reg.registry.nodes === 'object' ? reg.registry.nodes : {};
  const discoveredEcho = Object.entries(nodes)
    .filter(([_, n]) => Array.isArray(n?.capabilities) && n.capabilities.includes('echo'))
    .map(([id, n]) => ({ node_id: id, availability_status: n.availability_status || null, last_seen_ts: n.last_seen_ts || null, last_success_ts: n.last_success_ts || null }))
    .slice(0, 50);

  evidence.steps.responder_registry = {
    update: { ok: !!upd?.ok, path: upd?.path || null },
    path: reg?.path || null,
    node_count: Object.keys(nodes).length,
    echo_capable_sample: discoveredEcho,
  };

  // STEP 4 — Outbound tasks → remote pickup (non-self)
  const runsPath = path.join(outDir, 'runs.jsonl');
  let remoteOk = 0;
  let remoteTotal = 0;
  let nonSelfOk = 0;
  let ledgerMatch = null; // computed after reward step

  const selfNodeId = safeStr(snap?.self?.node_id) || null;

  const taskTypes = ['echo', 'summarize_text', 'decision_help'];
  const perType = Object.fromEntries(taskTypes.map((t) => [t, { attempted: 0, remote_attempted: 0, remote_success: 0, non_self_remote_success: 0 }]));

  const isUsable = (task_type, result) => {
    const r = result && typeof result === 'object' ? result : null;
    if (!r) return false;
    if (task_type === 'echo') return typeof r.message === 'string' && r.message.trim().length > 0;
    if (task_type === 'summarize_text') return typeof r.summary === 'string' && r.summary.trim().length > 0;
    if (task_type === 'decision_help') return typeof r.suggestion === 'string' && r.suggestion.trim().length > 0;
    return true;
  };

  for (let i = 0; i < runs; i++) {
    const task_type = taskTypes[i % taskTypes.length];
    const token = `gate-${Date.now()}-${i}-${crypto.randomBytes(2).toString('hex')}`;

    const payload = (() => {
      if (task_type === 'echo') return { text: token };
      if (task_type === 'summarize_text') return { text: `Please summarize: ${token} This is a release-gate test string.` };
      if (task_type === 'decision_help') return { question: `Release gate decision test: ${token}. Choose safest option.` };
      return { text: token };
    })();

    const body = { task_type, payload, timeout_ms: 2500, mode: 'network' };
    perType[task_type].attempted++;

    const r = await postJson(sidecarUrl, body, 4000);
    const j = r.json;

    const path0 = j?.trace?.path || null;
    const responder = j?.trace?.responder || null;

    const isRemote = path0 === 'network' && j?.status === 'success' && isUsable(task_type, j?.result);

    if (path0 === 'network') {
      remoteTotal++;
      perType[task_type].remote_attempted++;
    }
    if (isRemote) {
      remoteOk++;
      perType[task_type].remote_success++;
    }

    if (isRemote && responder && responder !== 'local' && (!selfNodeId || responder !== selfNodeId)) {
      nonSelfOk++;
      perType[task_type].non_self_remote_success++;
    }

    await appendJsonl(runsPath, {
      ok: !!r.ok,
      i,
      ts: nowIso(),
      request: body,
      response: j,
      derived: { isRemote, responder, selfNodeId },
    });
  }

  evidence.metrics.per_task_type = perType;

  evidence.metrics.remote_attempted = remoteTotal;
  evidence.metrics.remote_success = remoteOk;
  evidence.metrics.non_self_remote_success = nonSelfOk;
  evidence.metrics.non_self_remote_rate = remoteTotal ? nonSelfOk / remoteTotal : 0;

  // STEP 5 — Reward + ledger + explanation (synthetic economic chain using existing semantics)
  // This does NOT change reward semantics; it uses the same value→reward linkage model.
  const offer_id = `offer-gate-${crypto.randomUUID()}`;
  const task_type = 'echo';

  appendOfferFeedEvent({ offer_id, event_type: 'offer_created', task_type, expected_value: 1, source_super_identity_id: sourceSid }, { dataDir });
  appendOfferFeedEvent({ offer_id, event_type: 'offer_execution_won', task_type, expected_value: 1, source_super_identity_id: sourceSid, target_super_identity_id: winnerSid }, { dataDir });
  appendOfferFeedEvent({ offer_id, event_type: 'offer_executed', task_type, expected_value: 1, source_super_identity_id: sourceSid, target_super_identity_id: winnerSid }, { dataDir });

  const valueOut = emitValueForTaskSuccess({
    super_identity_id: sourceSid,
    context: {
      source_sid: 'system',
      expected_value: 1,
      offer_id,
      task_id: task_type,
      task_type,
      winner_sid: winnerSid,
      source_super_identity_id: winnerSid,
    },
    dataDir,
  });

  const amt = Number(valueOut?.event?.value || 1);
  const rewardOut = creditReward({
    super_identity_id: winnerSid,
    amount: amt,
    context: {
      offer_id,
      task_id: task_type,
      value_event_id: valueOut?.event?.event_id || null,
      source_super_identity_id: sourceSid,
      metadata: { release_gate: true, channel: 'release_gate' },
    },
  }, { dataDir });

  const reward_event_id = rewardOut?.event?.event_id || null;
  const econTrace = reward_event_id ? traceEconomicPathByRewardEvent(reward_event_id, { dataDir }) : null;
  const econSummary = econTrace ? summarizeEconomicTrace(econTrace) : null;

  evidence.steps.reward = {
    ok: !!(rewardOut?.ok && rewardOut?.credited && reward_event_id),
    offer_id,
    value_event_id: valueOut?.event?.event_id || null,
    reward_event_id,
    credited_amount: amt,
    economic_trace_summary: econSummary,
  };

  // STEP 6 — Repeatability check: require non-self remote success overall + per task_type.
  const per = evidence.metrics.per_task_type || {};
  const perChecks = {};
  let perOk = true;
  for (const [tt, st] of Object.entries(per)) {
    const attempted = Number(st?.attempted || 0);
    const need = Math.max(1, Math.floor(attempted * 0.7));
    const got = Number(st?.non_self_remote_success || 0);
    const ok = got >= need;
    perChecks[tt] = { attempted, need, got, ok };
    if (!ok) perOk = false;
  }

  evidence.steps.repeatability = {
    ok: perOk && (evidence.metrics.non_self_remote_success >= Math.max(1, Math.floor(runs * 0.7))),
    overall_target_non_self_success_min: Math.max(1, Math.floor(runs * 0.7)),
    per_task_type: perChecks,
  };

  evidence.finished_at = nowIso();

  // Write evidence bundle
  await writeJson(path.join(outDir, 'summary.json'), evidence);

  process.stdout.write(JSON.stringify({ ok: true, outDir, summary: evidence }, null, 2) + '\n');
}

main().catch((e) => {
  process.stderr.write(JSON.stringify({ ok: false, error: String(e?.message || e) }) + '\n');
  process.exit(1);
});
