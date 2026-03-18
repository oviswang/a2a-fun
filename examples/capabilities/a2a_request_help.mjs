import { getNetworkSnapshot } from '../../src/runtime/network/networkSnapshotV0_1.mjs';

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

export async function a2a_request_help(input) {
  const obj = input && typeof input === 'object' ? input : {};
  const request_type = String(obj.request_type || 'echo_ack').trim();
  if (request_type !== 'echo_ack') {
    return { ok: false, error: { code: 'UNSUPPORTED_REQUEST_TYPE' } };
  }

  const target_node_id = String(obj.target_node_id || '').trim();

  const snap = await getNetworkSnapshot({}).catch(() => null);
  const selfNodeId = snap?.self?.node_id ? String(snap.self.node_id) : null;
  if (!selfNodeId || selfNodeId.startsWith('unknown')) {
    return { ok: false, error: { code: 'SELF_ID_UNKNOWN' } };
  }

  let target = target_node_id || null;
  if (!target) {
    const ap = Array.isArray(snap?.active_peers) ? snap.active_peers : [];
    target = ap.length ? String(ap[0].node_id) : null;
  }
  if (!target) return { ok: false, error: { code: 'NO_TARGET_PEER' } };

  const relayUrl = String(process.env.RELAY_URL || 'wss://gw.bothook.me/relay').trim();
  const WebSocketCtor = await pickWebSocketCtor();
  if (!WebSocketCtor) return { ok: false, error: { code: 'NO_WEBSOCKET' } };

  const request_id = `help:${selfNodeId}:${target}:${Date.now()}`;

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
    }, 3000);

    const sendJson = (obj2) => {
      try { ws.send(JSON.stringify(obj2)); return true; } catch { return false; }
    };

    ws.onopen = () => {
      sendJson({ type: 'REGISTER', from: selfNodeId, ts: nowIso() });
    };

    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(String(ev.data)); } catch { return; }

      if (m?.type === 'REGISTER_ACK' && m?.to === selfNodeId && m?.accepted === true) {
        const payload = { request_type, from: selfNodeId, ts: nowIso(), request_id };
        const okSend = sendJson({
          type: 'SEND',
          from: selfNodeId,
          to: target,
          message_id: request_id,
          data: { topic: 'peer.help.request', payload }
        });
        log('HELP_REQUEST_SENT', { node_id: selfNodeId, target, request_id, ok: okSend });
        return;
      }

      if (m?.type === 'DELIVER') {
        const topic = m?.data?.topic;
        const payload = m?.data?.payload;
        if (topic === 'peer.help.response' && payload?.request_id === request_id) {
          clearTimeout(timeout);
          log('HELP_RESPONSE_RECEIVED', { node_id: selfNodeId, from: payload?.from || m?.from || null, request_id, status: payload?.status || null });
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
