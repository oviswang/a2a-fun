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

function mapNetworkErrorToReason(code) {
  const c = String(code || '').toUpperCase();
  if (c === 'TIMEOUT') return 'network_timeout';
  if (c === 'NO_WEBSOCKET') return 'relay_unavailable';
  if (c === 'WS_ERROR' || c === 'CLOSED') return 'relay_unavailable';
  return 'remote_unavailable';
}

async function networkExecute({ relayUrl, target, task_type, payload, timeout_ms }) {
  const WebSocketCtor = await pickWebSocketCtor();
  if (!WebSocketCtor) return { ok: false, error: { code: 'NO_WEBSOCKET' } };

  const request_id = `sidecar:${Date.now()}:${crypto.randomBytes(3).toString('hex')}`;
  const from = `a2a-sidecar:${process.pid}`;

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
      send({ type: 'REGISTER', from, ts: nowIso() });
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

async function main() {
  const port = Number(process.env.A2A_SIDECAR_PORT || 17888);
  const host = '127.0.0.1';

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/a2a/request') {
        return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND' } });
      }

      const body = await readJson(req);
      const task_type = String(body?.task_type || '').trim();
      const payload = body?.payload && typeof body.payload === 'object' ? body.payload : {};
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
      const target = String(body?.target || '').trim() || String(process.env.A2A_SIDECAR_DEFAULT_TARGET || '').trim();

      const wantNetwork = (mode !== 'local');
      const forceNetworkOnly = (mode === 'network');

      // 1) Network attempt (only when target is provided)
      if (wantNetwork && target) {
        const net = await networkExecute({ relayUrl, target, task_type, payload, timeout_ms });

        if (net.ok) {
          const remoteStatus = String(net.payload?.status || 'success');
          if (remoteStatus === 'success') {
            return sendJson(res, 200, makeResponse({
              status: 'success',
              result: net.payload?.result ?? null,
              trace: {
                path: 'network',
                responder: net.responder || null,
                task_type,
                summary: `Handled by remote node ${net.responder || 'unknown'} over A2A network.`,
                reason: 'local_fallback_not_needed',
                network_attempted: true,
                fallback_used: false,
                execution_time_ms: net.payload?.execution_time_ms ?? net.execution_time_ms,
              }
            }));
          }

          // Remote replied but did not succeed.
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
                execution_time_ms: net.execution_time_ms,
              }
            }));
          }

          // Auto mode: fall back locally.
          const reason = `remote_failed:${remoteStatus}`;
          return sendJson(res, 200, await handleLocal({ task_type, payload, reason, network_attempted: true }));
        }

        // Network failed.
        const reason = mapNetworkErrorToReason(net.error?.code);
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
              reason,
              network_attempted: true,
              fallback_used: false,
            }
          }));
        }

        return sendJson(res, 200, await handleLocal({ task_type, payload, reason, network_attempted: true }));
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
      const reason = target ? 'remote_unavailable' : 'no_reachable_remote_responder';
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
