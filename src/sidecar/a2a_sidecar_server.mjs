#!/usr/bin/env node
// A2A Sidecar Server (RC: Plugin First User Loop)
// Local HTTP service that provides structured A2A execution with network-first + local fallback.
//
// Contract (always JSON):
// {
//   status: "success"|"timeout"|"unavailable"|"failed",
//   result: object|null,
//   trace: {
//     path: "local_fallback"|"network",
//     responder: "local"|"<node_id>"|null,
//     task_type: string,
//     summary: string,
//     reason: string,
//     network_attempted: boolean,
//     fallback_used: boolean,
//     execution_time_ms?: number|null
//   }
// }

import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { updateResponderRegistry, loadResponderRegistry } from './responderRegistryV0_8_4.mjs';
import { selectCandidateAvailabilityAware } from '../routing/availabilityAwareRoutingV0_8_4.mjs';
import { recordResponderEvent, summarizeResponderHealth } from './responderHealthV0_8_4.mjs';

async function readJson(req, maxBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

function nowIso() { return new Date().toISOString(); }

function clampStr(s, n = 200) {
  const t = String(s ?? '');
  return t.length > n ? t.slice(0, n) : t;
}

function makeResponse({ status, result = null, trace }) {
  return {
    status,
    result,
    trace: {
      path: trace.path,
      responder: trace.responder ?? null,
      task_type: String(trace.task_type || '').trim() || 'unknown',
      summary: clampStr(trace.summary || ''),
      reason: clampStr(trace.reason || ''),
      network_attempted: Boolean(trace.network_attempted),
      fallback_used: Boolean(trace.fallback_used),
      execution_time_ms: typeof trace.execution_time_ms === 'number' ? trace.execution_time_ms : null,
      routing: trace.routing && typeof trace.routing === 'object' ? trace.routing : undefined,
      candidate_count: typeof trace.candidate_count === 'number' ? trace.candidate_count : undefined,
    }
  };
}

// ------------------------
// Local fallback handlers
// ------------------------
function localEcho(payload) {
  const text = typeof payload?.text === 'string' ? payload.text : '';
  return { message: `echo: ${text}` };
}

function localSummarize(payload) {
  const text = typeof payload?.text === 'string' ? payload.text : '';
  const clipped = text.length > 1200;
  const t = clipped ? text.slice(0, 1200) : text;
  const summary = t
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 60)
    .join(' ');
  return { summary, input_length: text.length, clipped };
}

function localDecision(payload) {
  const q = typeof payload?.question === 'string' ? payload.question : '';
  const suggestion = q ? 'Prefer the simplest reversible option.' : 'Provide a question.';
  const reasoning = q ? 'Fallback mode: give a conservative, reversible suggestion.' : 'Missing question.';
  return { suggestion, reasoning };
}

function localExecute(task_type, payload) {
  switch (task_type) {
    case 'echo':
      return localEcho(payload);
    case 'summarize_text':
      return localSummarize(payload);
    case 'decision_help':
      return localDecision(payload);
    default:
      throw new Error('UNSUPPORTED_TASK_TYPE');
  }
}

// ------------------------
// Network execution (minimal relay WS)
// ------------------------
async function pickWebSocketCtor() {
  try {
    const w = await import('ws');
    return w.WebSocket;
  } catch {
    return globalThis.WebSocket || null;
  }
}

function isUsableResult(task_type, payload, result) {
  const r = result && typeof result === 'object' ? result : null;
  if (!r) return false;

  if (task_type === 'echo') {
    if (typeof r.message !== 'string') return false;
    const msg = r.message.trim();
    if (!msg) return false;
    // NOTE: In the wild, responders are not fully consistent about echoing the exact input.
    // For network-availability gating we only require a non-empty message.
    return true;
  }

  if (task_type === 'summarize_text') return typeof r.summary === 'string' && r.summary.trim().length > 0;
  if (task_type === 'decision_help') return typeof r.suggestion === 'string' && r.suggestion.trim().length > 0;
  if (task_type === 'decision_help_v2') {
    if (!Array.isArray(r.scenarios) || r.scenarios.length < 3) return false;
    const hasProb = r.scenarios.every((s) => typeof s?.probability === 'number');
    return hasProb;
  }
  return true;
}

function mapNetworkErrorToReason(code) {
  const c = String(code || '').toUpperCase();
  if (c === 'TIMEOUT') return 'network_timeout';
  if (c === 'NO_WEBSOCKET') return 'relay_unavailable';
  if (c === 'WS_ERROR' || c === 'CLOSED') return 'relay_unavailable';
  return 'remote_unavailable';
}

async function networkExecute({ relayUrl, target, task_type, payload, timeout_ms, from_node_id }) {
  const WebSocketCtor = await pickWebSocketCtor();
  if (!WebSocketCtor) return { ok: false, error: { code: 'NO_WEBSOCKET' } };

  const request_id = `sidecar:${Date.now()}:${crypto.randomBytes(3).toString('hex')}`;
  // IMPORTANT: relay addressing expects a stable node_id-style sender for routing/ACLs.
  // If missing, many relays will accept REGISTER but drop SEND/DELIVER routing.
  const from = String(from_node_id || '').trim() || `a2a-sidecar:${process.pid}`;

  const t0 = Date.now();
  return await new Promise((resolve) => {
    let done = false;
    const ws = new WebSocketCtor(relayUrl);

    const finish = (r) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}
      resolve(r);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: { code: 'TIMEOUT' }, request_id, target });
    }, Math.max(200, Number(timeout_ms) || 5000));

    const send = (obj) => {
      try { ws.send(JSON.stringify(obj)); return true; } catch { return false; }
    };

    ws.onopen = () => {
      send({ type: 'REGISTER', from, node_id: from, ts: nowIso() });
    };

    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(String(ev.data)); } catch { return; }

      if (m?.type === 'REGISTER_ACK' && m?.to === from && m?.accepted === true) {
        send({
          type: 'SEND',
          from,
          to: target,
          message_id: request_id,
          data: { topic: 'peer.task.request', payload: { request_id, task_type, payload, ts: nowIso(), from } }
        });
        return;
      }

      if (m?.type === 'DELIVER') {
        const topic = m?.data?.topic;
        const p = m?.data?.payload;
        if (topic === 'peer.task.response' && p?.request_id === request_id) {
          clearTimeout(timer);
          const dt = Date.now() - t0;
          finish({ ok: true, request_id, target, responder: p?.from || m?.from || null, payload: p, execution_time_ms: dt });
        }
      }
    };

    ws.onerror = () => { clearTimeout(timer); finish({ ok: false, error: { code: 'WS_ERROR' }, request_id, target }); };
    ws.onclose = () => { clearTimeout(timer); if (!done) finish({ ok: false, error: { code: 'CLOSED' }, request_id, target }); };
  });
}

async function handleLocal({ task_type, payload, reason, network_attempted }) {
  try {
    const t0 = Date.now();
    const out = localExecute(task_type, payload);
    const dt = Date.now() - t0;

    return makeResponse({
      status: 'success',
      result: out,
      trace: {
        path: 'local_fallback',
        responder: 'local',
        task_type,
        summary: `Handled locally because ${reason.replace(/_/g, ' ')}.`,
        reason,
        network_attempted,
        fallback_used: true,
        execution_time_ms: dt,
      }
    });
  } catch (e) {
    return makeResponse({
      status: 'failed',
      result: null,
      trace: {
        path: 'local_fallback',
        responder: 'local',
        task_type,
        summary: 'Local fallback failed.',
        reason: String(e?.message || e),
        network_attempted,
        fallback_used: true,
      }
    });
  }
}

function envEnabled(name, def = true) {
  const v = String(process.env[name] ?? '').trim();
  if (!v) return def;
  return v !== '0' && v.toLowerCase() !== 'false';
}

async function main() {
  const port = Number(process.env.A2A_SIDECAR_PORT || 17888);
  const host = '127.0.0.1';
  const dataDir = String(process.env.A2A_DATA_DIR || path.join(process.cwd(), 'data'));

  // Stable sender identity for relay routing.
  const selfNodeId = String(process.env.A2A_NODE_ID || '').trim()
    || (await fs.readFile(path.join(dataDir, 'node_id'), 'utf8').catch(() => '')).trim()
    || `a2a-sidecar-${process.pid}`;

  const enableDiscovery = envEnabled('A2A_ENABLE_RESPONDER_DISCOVERY', true);
  const enableAvailabilityRouting = envEnabled('A2A_ENABLE_AVAILABILITY_ROUTING', true);
  const enableAutoDownrank = envEnabled('A2A_ENABLE_AUTO_DOWNRANK', true);

  // v0.9.0: stability controls (additive)
  const enableInflightCap = envEnabled('A2A_ENABLE_INFLIGHT_CAP', true);
  const inflightCap = Math.max(1, Number(process.env.A2A_NODE_INFLIGHT_CAP || 1));

  const enableCircuitBreaker = envEnabled('A2A_ENABLE_CIRCUIT_BREAKER', true);
  const breakerTimeoutThreshold = Math.max(1, Number(process.env.A2A_BREAKER_TIMEOUT_THRESHOLD || 2));
  const breakerOpenMs = Math.max(5_000, Number(process.env.A2A_BREAKER_OPEN_MS || 60_000));

  let lastRegistryUpdateMs = 0;
  const lastHealthStatus = new Map(); // node_id -> last derived health_status

  // v0.9.0: in-process stability state (best-effort, memory-only)
  const inflightByNode = new Map(); // node_id -> count
  const breakerByNode = new Map(); // node_id -> { openUntilMs, timeoutStreak }

  const server = http.createServer(async (req, res) => {
    try {
      // Admin: ask the sidecar to reload by exiting (systemd Restart=on-failure will bring it back).
      // This is used to make upgrades take effect without sudo.
      if (req.method === 'POST' && req.url === '/admin/reload') {
        sendJson(res, 200, { ok: true, ts: nowIso(), action: 'exit_for_reload' });
        // Exit on next tick so the response flushes.
        setTimeout(() => process.exit(1), 50);
        return;
      }

      // v0.8.9: batch compare (requester-side skill primitive)
      if (req.method === 'POST' && req.url === '/a2a/compare') {
        const body = await readJson(req);
        const task_type = String(body?.task_type || '').trim();
        const payload0 = body?.payload && typeof body.payload === 'object' ? body.payload : {};
        const payload = { ...payload0 };
        const timeout_ms = Number(body?.timeout_ms || 8000);
        const mode = String(body?.mode || 'network').trim() || 'network';
        const cross_critique = Boolean(body?.cross_critique);

        const targets = Array.isArray(body?.targets)
          ? body.targets.map((x) => String(x).trim()).filter(Boolean).slice(0, 10)
          : [];

        if (!task_type) return sendJson(res, 400, { ok: false, error: { code: 'MISSING_TASK_TYPE' } });
        if (!targets.length) return sendJson(res, 400, { ok: false, error: { code: 'MISSING_TARGETS' } });

        // Call our own /a2a/request endpoint sequentially (avoid registry tmp collisions).
        const runs = [];
        for (const t of targets) {
          try {
            const r = await fetch(`http://${host}:${port}/a2a/request`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ task_type, payload, timeout_ms, mode, target: t }),
            });
            const j = await r.json().catch(() => null);
            runs.push({ target: t, ok: r.ok, http_status: r.status, response: j });
          } catch (e) {
            runs.push({ target: t, ok: false, http_status: 0, response: null, error: String(e?.message || e) });
          }
        }

        // Minimal aggregation: suggestion histogram + failures.
        const analysis = {
          ok: true,
          task_type,
          target_count: targets.length,
          success: runs.filter((x) => x.response?.status === 'success').length,
          failed: runs.filter((x) => x.response?.status !== 'success').length,
          suggestions: {},
          failure_reasons: {},
        };

        // decision_help: suggestion histogram
        // decision_help_v2: scenario probability aggregation
        analysis.scenario_probability_mean = null;

        const scenarioSums = {}; // name -> sum
        const scenarioCounts = {}; // name -> count

        for (const r of runs) {
          const resp = r.response;
          const st = resp?.status || 'failed';
          const reason = String(resp?.trace?.reason || resp?.trace?.reason_code || resp?.trace?.reason || resp?.trace?.summary || 'unknown').slice(0, 120);
          if (st !== 'success') analysis.failure_reasons[reason] = (analysis.failure_reasons[reason] || 0) + 1;

          const sug = typeof resp?.result?.suggestion === 'string' ? resp.result.suggestion.trim() : '';
          if (sug) analysis.suggestions[sug] = (analysis.suggestions[sug] || 0) + 1;

          if (task_type === 'decision_help_v2' && st === 'success') {
            const sc = resp?.result?.scenarios;
            if (Array.isArray(sc)) {
              for (const s of sc) {
                const name = String(s?.name || '').trim();
                const p2 = s?.probability;
                if (!name || typeof p2 !== 'number') continue;
                scenarioSums[name] = (scenarioSums[name] || 0) + p2;
                scenarioCounts[name] = (scenarioCounts[name] || 0) + 1;
              }
            }
          }
        }

        if (task_type === 'decision_help_v2') {
          const mean = {};
          for (const name of Object.keys(scenarioSums)) {
            const c = scenarioCounts[name] || 0;
            if (c > 0) mean[name] = scenarioSums[name] / c;
          }
          analysis.scenario_probability_mean = mean;
        }

        // Optional: cross-critique (best-effort)
        let critiques = null;
        if (cross_critique) {
          critiques = [];
          const raw = runs.map((x) => ({ target: x.target, status: x.response?.status || null, result: x.response?.result || null }));
          const text = `We ran task_type=${task_type} on multiple peers. Please critique the set of outputs and propose a better combined approach.\n\nOutputs=${JSON.stringify(raw)}`;
          for (const critic of targets) {
            try {
              const r2 = await fetch(`http://${host}:${port}/a2a/request`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ task_type: 'critique_text', payload: { text }, timeout_ms, mode: 'network', target: critic }),
              });
              const j2 = await r2.json().catch(() => null);
              critiques.push({ critic, ok: r2.ok, http_status: r2.status, response: j2 });
            } catch (e) {
              critiques.push({ critic, ok: false, http_status: 0, response: null, error: String(e?.message || e) });
            }
          }
        }

        return sendJson(res, 200, { ok: true, ts: nowIso(), runs, analysis, critiques });
      }

      if (req.method !== 'POST' || req.url !== '/a2a/request') {
        return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND' } });
      }

      const body = await readJson(req);
      const task_type = String(body?.task_type || '').trim();
      const payload0 = body?.payload && typeof body.payload === 'object' ? body.payload : {};
      // Additive payload normalization for better first-call compatibility with existing responders.
      const payload = { ...payload0 };
      if (task_type === 'echo' && typeof payload.text === 'string' && typeof payload.message !== 'string') payload.message = payload.text;
      if (task_type === 'summarize_text' && typeof payload.text === 'string' && typeof payload.input !== 'string') payload.input = payload.text;
      if (task_type === 'decision_help' && typeof payload.question === 'string' && typeof payload.prompt !== 'string') payload.prompt = payload.question;
      const timeout_ms = Number(body?.timeout_ms || 5000);
      const mode = String(body?.mode || 'auto').trim();

      if (!task_type) {
        return sendJson(res, 200, makeResponse({
          status: 'failed',
          result: null,
          trace: {
            path: 'local_fallback',
            responder: 'local',
            task_type: 'unknown',
            summary: 'Request failed: missing task_type.',
            reason: 'missing_task_type',
            network_attempted: false,
            fallback_used: false,
          }
        }));
      }

      // Network preconditions
      const relayUrl = String(process.env.RELAY_URL || 'wss://gw.bothook.me/relay').trim();
      const wantNetwork = (mode !== 'local');
      const forceNetworkOnly = (mode === 'network');

      const explicitTarget = String(body?.target || '').trim() || null;

      // v0.8.4: automatic responder discovery + derived registry (rollbackable)
      // Source of truth remains existing caches under dataDir (presence-cache / capabilities-cache / success & health stores).
      if (enableDiscovery) {
        const now = Date.now();
        if (now - lastRegistryUpdateMs > 30_000) {
          await updateResponderRegistry({ dataDir });
          lastRegistryUpdateMs = now;
        }
      }

      let registry = null;
      if (enableDiscovery) {
        const lr = await loadResponderRegistry({ dataDir });
        registry = lr?.registry || { ts: nowIso(), nodes: {} };
      }

      const isBreakerOpen = (nodeId) => {
        if (!enableCircuitBreaker) return false;
        const st = breakerByNode.get(nodeId);
        const until = Number(st?.openUntilMs || 0);
        return until > Date.now();
      };

      const canStartInflight = (nodeId) => {
        if (!enableInflightCap) return true;
        const n = Number(inflightByNode.get(nodeId) || 0);
        return n < inflightCap;
      };

      // Build target candidates (max 3) without default target dependency.
      // Rule:
      // - explicit params.target is honored
      // - otherwise, select from derived registry candidates only
      let targetCandidates = [];
      let routingMeta = null;

      if (explicitTarget) {
        targetCandidates = [explicitTarget];
        routingMeta = {
          availability_status: 'unknown',
          availability_bucket: 'explicit',
          availability_reason: 'explicit_target',
          attempted_targets: [explicitTarget],
        };
      } else if (enableDiscovery && enableAvailabilityRouting) {
        const nodes = registry?.nodes && typeof registry.nodes === 'object' ? registry.nodes : {};
        let all = Object.entries(nodes).map(([node_id, n]) => ({
          agent_id: String(node_id),
          name: String(node_id),
          summary: '',
          skills: Array.isArray(n?.capabilities) ? n.capabilities : [],
          last_seen: n?.last_seen_ts || null,
        }));

        // v0.9.0 availability gate extensions: avoid breaker-open nodes and busy nodes.
        all = all.filter((c) => {
          const id = String(c?.agent_id || '').trim();
          if (!id) return false;
          if (isBreakerOpen(id)) return false;
          if (!canStartInflight(id)) return false;
          return true;
        });

        // Pick up to 3 attempts, constrained to the highest non-empty availability bucket.
        const tried = new Set();
        let chosenBucket = null;

        for (let i = 0; i < 3; i++) {
          const remaining = all.filter((c) => !tried.has(String(c.agent_id)));
          const sel = selectCandidateAvailabilityAware({ candidates: remaining, task_type, registry, dataDir });
          if (!sel?.ok || !sel?.selected?.agent_id) {
            break;
          }

          if (!chosenBucket) chosenBucket = sel.routing?.availability_bucket || null;
          if (chosenBucket && sel.routing?.availability_bucket && sel.routing.availability_bucket !== chosenBucket) {
            // Do not drop into a lower bucket during normal exploration/retries.
            break;
          }

          const id = String(sel.selected.agent_id);
          tried.add(id);
          targetCandidates.push(id);

          routingMeta = {
            availability_status: sel.routing?.availability_status,
            availability_bucket: sel.routing?.availability_bucket,
            availability_reason: sel.routing?.availability_reason,
            bucket_counts: sel.routing?.bucket_counts,
          };
        }

        // v0.8.4 correctness: if no candidates exist, return structured unavailable (do not inject defaults).
        if (wantNetwork && targetCandidates.length === 0) {
          return sendJson(res, 200, makeResponse({
            status: 'unavailable',
            result: null,
            trace: {
              path: 'network',
              responder: null,
              task_type,
              summary: 'Remote execution unavailable: no available responder discovered.',
              reason: 'no_available_responder',
              network_attempted: false,
              fallback_used: false,
              routing: {
                availability_status: 'unavailable',
                availability_bucket: 'none',
                availability_reason: 'registry_empty_or_no_capability_match',
              },
              candidate_count: 0,
            },
          }));
        }
      } else if (!enableDiscovery) {
        // Rollback path: v0.8.3 target list behavior (explicit defaults).
        const primaryTarget = String(process.env.A2A_SIDECAR_DEFAULT_TARGET || '').trim();
        const fallbackTargets = String(process.env.A2A_SIDECAR_FALLBACK_TARGETS || '')
          .split(',')
          .map((x) => String(x || '').trim())
          .filter(Boolean);
        const seen = new Set();
        for (const t of [primaryTarget, ...fallbackTargets]) {
          const s = String(t || '').trim();
          if (!s) continue;
          if (seen.has(s)) continue;
          seen.add(s);
          targetCandidates.push(s);
          if (targetCandidates.length >= 3) break;
        }
        routingMeta = { availability_bucket: 'legacy_default_targets', availability_reason: 'discovery_disabled' };
      }

      // Attach attempted targets for explainability
      if (routingMeta && typeof routingMeta === 'object' && !routingMeta.attempted_targets) {
        routingMeta.attempted_targets = [...targetCandidates];
      }

      // 1) Network attempt (up to 3 targets)
      if (wantNetwork && targetCandidates.length) {
        let attempted = 0;
        let lastFailureReason = 'remote_unavailable';

        for (const target of targetCandidates) {
          attempted++;

          // v0.9.0: skip breaker-open nodes unless explicitly targeted
          if (!explicitTarget && isBreakerOpen(target)) {
            lastFailureReason = 'circuit_breaker_open';
            continue;
          }

          // v0.9.0: inflight cap
          if (!canStartInflight(target)) {
            lastFailureReason = 'node_busy';
            continue;
          }

          // increment inflight
          if (enableInflightCap) {
            inflightByNode.set(target, Number(inflightByNode.get(target) || 0) + 1);
          }

          let net = null;
          try {
            net = await networkExecute({ relayUrl, target, task_type, payload, timeout_ms, from_node_id: selfNodeId });
          } finally {
            if (enableInflightCap) {
              const n = Math.max(0, Number(inflightByNode.get(target) || 0) - 1);
              if (n === 0) inflightByNode.delete(target);
              else inflightByNode.set(target, n);
            }
          }

          const emitHealthTransition = (nodeId) => {
            if (!enableAutoDownrank) return;
            try {
              const h = summarizeResponderHealth(nodeId, { dataDir });
              const prev = lastHealthStatus.get(nodeId) || null;
              const next = h.status;
              if (next && next !== prev) {
                lastHealthStatus.set(nodeId, next);
                if ((next === 'degraded' || next === 'unreliable') && prev !== next) {
                  console.log(JSON.stringify({ ok: true, event: 'RESPONDER_DOWNRANKED', node_id: nodeId, from: prev, to: next, ts: nowIso(), stats: h.stats }));
                }
                if (next === 'healthy' && (prev === 'degraded' || prev === 'unreliable')) {
                  console.log(JSON.stringify({ ok: true, event: 'RESPONDER_RECOVERED', node_id: nodeId, from: prev, to: next, ts: nowIso(), stats: h.stats }));
                }
              }
            } catch {}
          };

          if (net.ok) {
            const remoteStatus = String(net.payload?.status || 'success');
            const remoteOk = remoteStatus === 'success' || remoteStatus === 'ok';

            if (remoteOk) {
              let remoteResult = net.payload?.result ?? null;

              // Compatibility: some responders return decision_help as { recommendation, reasoning }
              // instead of { suggestion, reasoning }.
              if (task_type === 'decision_help' && remoteResult && typeof remoteResult === 'object') {
                if (typeof remoteResult.suggestion !== 'string' && typeof remoteResult.recommendation === 'string') {
                  remoteResult = { ...remoteResult, suggestion: remoteResult.recommendation };
                }
              }

              const usable = isUsableResult(task_type, payload, remoteResult);

              if (!usable) {
                lastFailureReason = 'remote_unusable_result';
                if (enableAutoDownrank) {
                  recordResponderEvent({ node_id: target, task_type, kind: 'failure', dataDir });
                  emitHealthTransition(target);
                }
                if (forceNetworkOnly) {
                  return sendJson(res, 200, makeResponse({
                    status: 'failed',
                    result: remoteResult,
                    trace: {
                      path: 'network',
                      responder: net.responder || null,
                      task_type,
                      summary: 'Remote execution returned an unusable result.',
                      reason: 'remote_unusable_result',
                      network_attempted: true,
                      fallback_used: false,
                      routing: routingMeta,
                      candidate_count: targetCandidates.length,
                      execution_time_ms: net.payload?.execution_time_ms ?? net.execution_time_ms,
                    }
                  }));
                }
                continue;
              }

              // v0.9.0: breaker recovery on success
              if (enableCircuitBreaker) {
                breakerByNode.set(target, { openUntilMs: 0, timeoutStreak: 0 });
              }

              if (enableAutoDownrank) {
                recordResponderEvent({ node_id: target, task_type, kind: 'success', dataDir });
                emitHealthTransition(target);
              }

              return sendJson(res, 200, makeResponse({
                status: 'success',
                result: remoteResult,
                trace: {
                  path: 'network',
                  responder: net.responder || null,
                  task_type,
                  summary: `Handled by remote node ${net.responder || 'unknown'} over A2A network.`,
                  reason: 'local_fallback_not_needed',
                  network_attempted: true,
                  fallback_used: false,
                  routing: routingMeta,
                  candidate_count: targetCandidates.length,
                  execution_time_ms: net.payload?.execution_time_ms ?? net.execution_time_ms,
                }
              }));
            }

            lastFailureReason = `remote_failed:${remoteStatus}`;
            if (enableAutoDownrank) {
              const kind = remoteStatus === 'unsupported' ? 'unsupported' : 'failure';
              recordResponderEvent({ node_id: target, task_type, kind, dataDir });
              emitHealthTransition(target);
            }

            if (forceNetworkOnly) {
              return sendJson(res, 200, makeResponse({
                status: 'failed',
                result: net.payload?.result ?? null,
                trace: {
                  path: 'network',
                  responder: net.responder || null,
                  task_type,
                  summary: 'Remote execution failed.',
                  reason: `remote_failed:${remoteStatus}`,
                  network_attempted: true,
                  fallback_used: false,
                  routing: routingMeta,
                  candidate_count: targetCandidates.length,
                  execution_time_ms: net.execution_time_ms,
                }
              }));
            }
            continue;
          }

          lastFailureReason = mapNetworkErrorToReason(net.error?.code);

          // v0.9.0: circuit breaker on repeated timeouts
          if (enableCircuitBreaker) {
            const isTimeout = String(net.error?.code || '').toUpperCase() === 'TIMEOUT';
            if (isTimeout) {
              const prev = breakerByNode.get(target) || { openUntilMs: 0, timeoutStreak: 0 };
              const nextStreak = Number(prev.timeoutStreak || 0) + 1;
              let openUntilMs = Number(prev.openUntilMs || 0);
              if (nextStreak >= breakerTimeoutThreshold) {
                openUntilMs = Date.now() + breakerOpenMs;
                try {
                  console.log(JSON.stringify({ ok: true, event: 'CIRCUIT_BREAKER_OPEN', node_id: target, ts: nowIso(), timeout_streak: nextStreak, open_ms: breakerOpenMs }));
                } catch {}
              }
              breakerByNode.set(target, { openUntilMs, timeoutStreak: nextStreak });
            }
          }
          if (enableAutoDownrank) {
            const kind = String(net.error?.code || '').toUpperCase() === 'TIMEOUT' ? 'timeout' : 'failure';
            recordResponderEvent({ node_id: target, task_type, kind, dataDir });
            emitHealthTransition(target);
          }

          if (forceNetworkOnly) {
            const status = String(net.error?.code || '').toUpperCase() === 'TIMEOUT' ? 'timeout' : 'unavailable';
            return sendJson(res, 200, makeResponse({
              status,
              result: null,
              trace: {
                path: 'network',
                responder: null,
                task_type,
                summary: 'Remote execution unavailable.',
                reason: lastFailureReason,
                network_attempted: true,
                fallback_used: false,
                routing: routingMeta,
                candidate_count: targetCandidates.length,
              }
            }));
          }
        }

        // Auto mode: fall back locally after attempts.
        return sendJson(res, 200, await handleLocal({ task_type, payload, reason: lastFailureReason, network_attempted: attempted > 0 }));
      }

      // 2) No network attempt possible
      if (forceNetworkOnly) {
        return sendJson(res, 200, makeResponse({
          status: 'unavailable',
          result: null,
          trace: {
            path: 'network',
            responder: null,
            task_type,
            summary: 'Remote execution unavailable (missing target).',
            reason: 'no_reachable_remote_responder',
            network_attempted: false,
            fallback_used: false,
          }
        }));
      }

      // 3) Local fallback (auto/local)
      const reason = explicitTarget ? 'remote_unavailable' : 'no_reachable_remote_responder';
      return sendJson(res, 200, await handleLocal({ task_type, payload, reason, network_attempted: false }));

    } catch (err) {
      return sendJson(res, 200, makeResponse({
        status: 'failed',
        result: null,
        trace: {
          path: 'local_fallback',
          responder: 'local',
          task_type: 'unknown',
          summary: 'Request failed (internal error).',
          reason: String(err?.message || err),
          network_attempted: false,
          fallback_used: false,
        }
      }));
    }
  });

  server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, event: 'A2A_SIDECAR_LISTENING', host, port, ts: nowIso() }));
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ ok: false, event: 'A2A_SIDECAR_FATAL', ts: nowIso(), error: String(e?.message || e) }));
  process.exit(1);
});
