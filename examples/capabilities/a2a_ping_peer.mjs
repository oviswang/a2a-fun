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

export async function a2a_ping_peer(input) {
  const target_node_id = input && typeof input === 'object' ? String(input.target_node_id || '').trim() : '';

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

  const connId = `ping:${selfNodeId}:${Date.now()}`;
  const msgId = `peer.ping:${selfNodeId}:${target}:${Date.now()}`;

  return await new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}
      resolve(r);
    };

    const ws = new WebSocketCtor(relayUrl);

    const timeout = setTimeout(() => {
      finish({ ok: true, result: { target, pong: false } });
    }, 2500);

    const sendJson = (obj) => {
      try { ws.send(JSON.stringify(obj)); return true; } catch { return false; }
    };

    ws.onopen = () => {
      // Register as self node_id
      // Match relay protocol used by the daemon integration.
      sendJson({ type: 'REGISTER', from: selfNodeId, ts: nowIso(), conn_id: connId });
    };

    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(String(ev.data)); } catch { return; }

      if (m?.type === 'REGISTER_ACK' && m?.to === selfNodeId && m?.accepted === true) {
        // Send ping
        const payload = { type: 'PING', from: selfNodeId, ts: nowIso() };
        const okSend = sendJson({ type: 'SEND', from: selfNodeId, to: target, message_id: msgId, data: { topic: 'peer.ping', payload } });
        log('PING_SENT', { node_id: selfNodeId, target, ok: okSend });
        return;
      }

      if (m?.type === 'DELIVER') {
        const topic = m?.data?.topic;
        const payload = m?.data?.payload;
        if (topic === 'peer.pong' && payload?.type === 'PONG' && String(payload?.to || '') === selfNodeId) {
          clearTimeout(timeout);
          log('PONG_RECEIVED', { node_id: selfNodeId, from: payload?.from || m?.from || null });
          finish({ ok: true, result: { target, pong: true, from: payload?.from || m?.from || null } });
        }
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      finish({ ok: false, error: { code: 'WS_ERROR' } });
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      if (!done) finish({ ok: true, result: { target, pong: false } });
    };
  });
}
