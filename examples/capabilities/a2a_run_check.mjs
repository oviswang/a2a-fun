import { getNetworkSnapshot } from '../../src/runtime/network/networkSnapshotV0_1.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

async function pickWebSocketCtor() {
  try {
    const w = await import('ws');
    return w.WebSocket;
  } catch {
    return globalThis.WebSocket || null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function log(event, fields = {}) {
  console.log(JSON.stringify({ ok: true, event, ts: nowIso(), ...fields }));
}

export async function a2a_run_check(input) {
  const obj = input && typeof input === 'object' ? input : {};
  const task_type = String(obj.check_type || obj.task_type || 'runtime_status').trim();
  const supported = new Set(['runtime_status', 'network_snapshot', 'trust_summary', 'presence_status', 'capability_summary']);
  if (!supported.has(task_type)) {
    return { ok: false, error: { code: 'UNSUPPORTED_TASK_TYPE', task_type } };
  }

  const target_node_id = String(obj.target_node_id || '').trim();

  const snap = await getNetworkSnapshot({}).catch(() => null);
  const selfNodeId = snap?.self?.node_id ? String(snap.self.node_id) : null;
  if (!selfNodeId || selfNodeId.startsWith('unknown')) {
    return { ok: false, error: { code: 'SELF_ID_UNKNOWN' } };
  }

  const cachePath = path.join(String(process.env.A2A_WORKSPACE_PATH || process.cwd()), 'data', 'capability-summary-cache.json');
  let capabilityCache = { ok: true, updated_at: null, peers: {} };
  try {
    const raw = await fs.readFile(cachePath, 'utf8').catch(() => null);
    const j = raw ? JSON.parse(String(raw)) : null;
    if (j && typeof j === 'object' && j.peers && typeof j.peers === 'object') capabilityCache = j;
  } catch {}

  const trustScore = (t) => (t === 'VERIFIED' ? 2 : t === 'UNVERIFIED' || !t ? 1 : t === 'INVALID' ? 0 : t === 'QUARANTINED' ? -1 : 1);
  const supportsTask = (p) => {
    const nodeId = String(p?.node_id || '').trim();
    const arr = Array.isArray(p?.supported_task_types)
      ? p.supported_task_types
      : (capabilityCache.peers?.[nodeId]?.supported_task_types || null);
    if (!arr || !Array.isArray(arr)) return null; // unknown
    return arr.includes(task_type);
  };

  let target = target_node_id || null;
  if (!target) {
    const ap = Array.isArray(snap?.active_peers) ? snap.active_peers : [];
    const bp = Array.isArray(snap?.bootstrap_peers) ? snap.bootstrap_peers : [];
    const base = ap.length ? ap : bp;

    const candidates = base
      .map((p) => ({
        // bootstrap_peers use node_id; active_peers use node_id
        node_id: String(p?.node_id || '').trim(),
        trust_level: p?.trust_level || 'UNVERIFIED',
        trust_state: p?.trust_state || p?.trust_level || 'UNVERIFIED',
        age_ms: typeof p?.age_ms === 'number' ? p.age_ms : null,
        capability_match: supportsTask(p) // true | false | null(unknown)
      }))
      .filter((x) => x.node_id);

    log('MATCH_CANDIDATES', { task_type, candidates });

    const explicitlySupported = candidates.filter((c) => c.capability_match === true);
    const pool0 = explicitlySupported.length ? explicitlySupported : candidates;

    // Exclude INVALID/QUARANTINED if any better peers exist (governance hardening)
    const betterExists = pool0.some((c) => trustScore(c.trust_state) >= 1);
    const pool = betterExists ? pool0.filter((c) => trustScore(c.trust_state) >= 1) : pool0;
    const excluded_invalid = betterExists ? (pool0.length - pool.length) : 0;

    pool.sort((a, b) => {
      const ta = trustScore(a.trust_state);
      const tb = trustScore(b.trust_state);
      if (ta !== tb) return tb - ta; // higher first
      const aa = a.age_ms ?? 1e18;
      const ab = b.age_ms ?? 1e18;
      if (aa !== ab) return aa - ab; // fresher first
      return String(a.node_id).localeCompare(String(b.node_id));
    });

    target = pool.length ? pool[0].node_id : null;

    log('MATCH_SELECTED', {
      task_type,
      chosen: target,
      reason: explicitlySupported.length ? 'capability+trust+freshness' : 'trust+freshness fallback',
      excluded_invalid
    });
  }
  if (!target) return { ok: false, error: { code: 'NO_TARGET_PEER' } };

  const relayUrl = String(process.env.RELAY_URL || 'wss://gw.bothook.me/relay').trim();
  const WebSocketCtor = await pickWebSocketCtor();
  if (!WebSocketCtor) return { ok: false, error: { code: 'NO_WEBSOCKET' } };

  const request_id = `check:${selfNodeId}:${target}:${Date.now()}`;

  return await new Promise((resolve) => {
    let done = false;
    const ws = new WebSocketCtor(relayUrl);

    const finish = (r) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}
      resolve(r);
    };

    const timeout = setTimeout(() => {
      finish({ ok: true, result: { target, request_id, received: false } });
    }, 3500);

    const sendJson = (obj2) => {
      try { ws.send(JSON.stringify(obj2)); return true; } catch { return false; }
    };

    ws.onopen = () => {
      sendJson({ type: 'REGISTER', from: selfNodeId, ts: nowIso() });
    };

    ws.onmessage = async (ev) => {
      let m;
      try { m = JSON.parse(String(ev.data)); } catch { return; }

      if (m?.type === 'REGISTER_ACK' && m?.to === selfNodeId && m?.accepted === true) {
        const payload = { task_type, check_type: task_type, from: selfNodeId, ts: nowIso(), request_id };
        const okSend = sendJson({
          type: 'SEND',
          from: selfNodeId,
          to: target,
          message_id: request_id,
          data: { topic: 'peer.task.request', payload }
        });
        log('TASK_REQUEST_SENT', { node_id: selfNodeId, target, request_id, ok: okSend, task_type });
        return;
      }

      if (m?.type === 'DELIVER') {
        const topic = m?.data?.topic;
        const payload = m?.data?.payload;
        if (topic === 'peer.task.response' && payload?.request_id === request_id) {
          clearTimeout(timeout);
          log('TASK_RESPONSE_RECEIVED', { node_id: selfNodeId, from: payload?.from || m?.from || null, request_id, status: payload?.status || null, task_type: payload?.task_type || null });

          // Cache last-known capability_summary responses (local-only hint)
          try {
            if (payload?.task_type === 'capability_summary' && payload?.status === 'ok') {
              const peerId = String(payload?.from || '').trim();
              const stt = Array.isArray(payload?.result?.supported_task_types) ? payload.result.supported_task_types.slice(0, 12) : null;
              if (peerId && stt && stt.length) {
                capabilityCache.peers = capabilityCache.peers && typeof capabilityCache.peers === 'object' ? capabilityCache.peers : {};
                capabilityCache.peers[peerId] = { supported_task_types: stt, updated_at: nowIso(), protocol_version: payload?.result?.protocol_version || 'v0.1' };
                capabilityCache.updated_at = nowIso();
                await fs.mkdir(path.dirname(cachePath), { recursive: true }).catch(() => {});
                await fs.writeFile(cachePath, JSON.stringify(capabilityCache, null, 2) + '\n', 'utf8').catch(() => {});
              }
            }
          } catch {}

          finish({ ok: true, result: { target, request_id, received: true, response: payload } });
        }
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      finish({ ok: false, error: { code: 'WS_ERROR' } });
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      if (!done) finish({ ok: true, result: { target, request_id, received: false } });
    };
  });
}
