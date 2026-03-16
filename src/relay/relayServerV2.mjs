import http from 'node:http';
import crypto from 'node:crypto';

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function wsAccept(key) {
  return crypto
    .createHash('sha1')
    .update(String(key) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', 'utf8')
    .digest('base64');
}

function writeWsText(socket, obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = [];
  header.push(0x81);
  if (payload.length < 126) {
    header.push(payload.length);
  } else if (payload.length < 65536) {
    header.push(126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  } else {
    // v2 remains minimal; no large frames
    return;
  }
  socket.write(Buffer.concat([Buffer.from(header), payload]));
}

function readWsFrames(buffer) {
  const frames = [];
  let off = 0;

  while (off + 2 <= buffer.length) {
    const b0 = buffer[off];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    if (!fin) break;

    const b1 = buffer[off + 1];
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let hdrLen = 2;

    if (len === 126) {
      if (off + 4 > buffer.length) break;
      len = (buffer[off + 2] << 8) | buffer[off + 3];
      hdrLen = 4;
    } else if (len === 127) {
      break;
    }

    const maskLen = masked ? 4 : 0;
    const frameLen = hdrLen + maskLen + len;
    if (off + frameLen > buffer.length) break;

    let payload = buffer.subarray(off + hdrLen + maskLen, off + frameLen);
    if (masked) {
      const mask = buffer.subarray(off + hdrLen, off + hdrLen + 4);
      const out = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ mask[i % 4];
      payload = out;
    }

    frames.push({ opcode, payload });
    off += frameLen;
    if (opcode === 0x8) break;
  }

  return { frames, rest: buffer.subarray(off) };
}

function writeWsPong(socket, payload) {
  const p = Buffer.isBuffer(payload) ? payload : Buffer.from([], 'utf8');
  const header = [];
  header.push(0x8a);
  if (p.length < 126) {
    header.push(p.length);
  } else if (p.length < 65536) {
    header.push(126, (p.length >> 8) & 0xff, p.length & 0xff);
  } else {
    return;
  }
  socket.write(Buffer.concat([Buffer.from(header), p]));
}

function nowIso() {
  return new Date().toISOString();
}

function validateId(raw, code) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { ok: false, code, reason: 'required' };
  if (s.length > 128) return { ok: false, code, reason: 'too_long' };
  return { ok: true, value: s };
}

function regKey(node_id, session_id) {
  return `${node_id}::${session_id}`;
}

/**
 * Relay v2 (explicit registration model).
 *
 * Registration message:
 * { type:'register', node_id:'...', session_id:'...' }
 *
 * Deterministic duplicate policy:
 * - same (node_id, session_id): replace mapping to new socket; close old socket (best-effort)
 * - same node_id, different session_id: allow multiple; latest registration becomes the default route for `to=node_id`
 */
export function createRelayServerV2({ bindHost = '127.0.0.1', port = 3111, wsPath = '/relay' } = {}) {
  // (node_id, session_id) -> entry
  const entries = new Map();
  // node_id -> latest session_id
  const latestByNode = new Map();

  // In-memory bounded trace log (append order).
  const traces = [];
  const TRACE_CAP = 1000;

  function pushTrace(t) {
    traces.push(t);
    if (traces.length > TRACE_CAP) traces.splice(0, traces.length - TRACE_CAP);
  }

  function trace({ event, trace_id = null, from = null, to = null, kind = null, ts = null } = {}) {
    pushTrace({
      event: String(event || 'unknown'),
      trace_id: trace_id === null ? null : String(trace_id),
      from: from === null ? null : String(from),
      to: to === null ? null : String(to),
      kind: kind === null ? null : String(kind),
      ts: ts || nowIso()
    });
  }

  function log(event, fields = {}) {
    // Minimal, machine-safe structured logging.
    // No payload logging.
    try {
      console.log(JSON.stringify({
        ok: true,
        component: 'relay.v2',
        event,
        ts: nowIso(),
        ...fields
      }));
    } catch {
      // ignore
    }
  }

  function recomputeLatest(node_id) {
    let best = null;
    for (const e of entries.values()) {
      if (e.node_id !== node_id) continue;
      if (!best || e.connected_at > best.connected_at) best = e;
    }
    if (best) latestByNode.set(node_id, best.session_id);
    else latestByNode.delete(node_id);
  }

  const server = http.createServer((req, res) => {
    // Minimal read-only diagnostics.
    if (req.method === 'GET' && req.url === '/nodes') {
      const nodes = [];
      for (const e of entries.values()) {
        nodes.push({
          node_id: e.node_id,
          session_id: e.session_id,
          connected_at: e.connected_at,
          last_seen: e.last_seen,
          is_latest: latestByNode.get(e.node_id) === e.session_id
        });
      }
      nodes.sort((a, b) => {
        const n = String(a.node_id).localeCompare(String(b.node_id));
        if (n !== 0) return n;
        return String(a.session_id).localeCompare(String(b.session_id));
      });

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, nodes }));
      return;
    }

    if (req.method === 'GET' && req.url === '/traces') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, traces }));
      return;
    }

    if (req.method === 'GET' && req.url === '/network_stats') {
      // Minimal, best-effort network stats. Country-level only.
      const now = new Date();
      const dayKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;

      // connected nodes: current relay connections (entries)
      const connected_nodes = entries.size;

      // unique nodes seen today: based on traces register events today
      const seenToday = new Set();
      const newToday = new Set();
      for (const t of traces) {
        if (t.event !== 'register') continue;
        if (!t.ts || String(t.ts).slice(0, 10) !== dayKey) continue;
        if (t.from) seenToday.add(String(t.from));
      }
      // new_nodes_today: nodes that registered today but had no register before today
      const seenBefore = new Set();
      for (const t of traces) {
        if (t.event !== 'register') continue;
        if (!t.from) continue;
        if (!t.ts) continue;
        const d = String(t.ts).slice(0, 10);
        if (d < dayKey) seenBefore.add(String(t.from));
      }
      for (const n of seenToday) {
        if (!seenBefore.has(n)) newToday.add(n);
      }

      // active regions: country only (best-effort)
      // If env provides a simple mapping, use it: RELAY_COUNTRY_BY_NODE='node1=SG,node2=CN'
      const mapEnv = typeof process.env.RELAY_COUNTRY_BY_NODE === 'string' ? process.env.RELAY_COUNTRY_BY_NODE : '';
      const map = new Map();
      if (mapEnv.trim()) {
        for (const part of mapEnv.split(',')) {
          const [k, v] = part.split('=');
          const kk = k ? k.trim() : '';
          const vv = v ? v.trim().toUpperCase() : '';
          if (kk && vv) map.set(kk, vv);
        }
      }

      // current connected node_ids list
      const connectedNodeIds = [];
      for (const e of entries.values()) connectedNodeIds.push(e.node_id);

      const regionCounts = new Map();
      for (const n of connectedNodeIds) {
        const c = map.get(n) || null;
        if (!c) continue;
        regionCounts.set(c, (regionCounts.get(c) || 0) + 1);
      }

      const countryNames = {
        SG: 'Singapore',
        CN: 'China',
        US: 'United States',
        JP: 'Japan',
        DE: 'Germany',
        GB: 'United Kingdom',
        FR: 'France',
        AU: 'Australia',
        IN: 'India'
      };

      const active_regions = Array.from(regionCounts.entries())
        .map(([code, count]) => ({ code, country: countryNames[code] || code, count }))
        .sort((a, b) => b.count - a.count || String(a.code).localeCompare(String(b.code)));

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        kind: 'NETWORK_STATS_V0_1',
        day: dayKey,
        connected_nodes,
        unique_node_ids_seen_today: seenToday.size,
        new_nodes_today: newToday.size,
        active_regions
      }));
      return;
    }

    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
  });

  server.on('upgrade', (req, socket) => {
    try {
      if (req.url !== wsPath) {
        socket.destroy();
        return;
      }

      const key = req.headers['sec-websocket-key'];
      if (!key) {
        socket.destroy();
        return;
      }

      const accept = wsAccept(key);
      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${accept}`,
          '',
          ''
        ].join('\r\n')
      );

      let buf = Buffer.alloc(0);
      let reg = null; // { node_id, session_id }

      function cleanup() {
        if (reg) {
          const k = regKey(reg.node_id, reg.session_id);
          const cur = entries.get(k);
          if (cur && cur.socket === socket) {
            entries.delete(k);
            recomputeLatest(reg.node_id);
            log('unregister', { node_id: reg.node_id, session_id: reg.session_id });
            trace({ event: 'unregister', from: reg.node_id, to: null, trace_id: null, kind: null });
          }
        }
        reg = null;
      }

      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const { frames, rest } = readWsFrames(buf);
        buf = rest;

        for (const fr of frames) {
          if (fr.opcode === 0x8) {
            cleanup();
            try { socket.end(); } catch {}
            continue;
          }
          if (fr.opcode === 0x9) {
            writeWsPong(socket, fr.payload);
            continue;
          }
          if (fr.opcode !== 0x1) continue;

          const msg = safeJsonParse(fr.payload.toString('utf8'));
          if (!msg || typeof msg !== 'object') continue;

          if (msg.type === 'register') {
            const vn = validateId(msg.node_id, 'INVALID_NODE_ID');
            const vs = validateId(msg.session_id, 'INVALID_SESSION_ID');
            if (!vn.ok) {
              log('register_reject', { code: vn.code });
              writeWsText(socket, { ok: false, error: { code: vn.code, reason: vn.reason } });
              continue;
            }
            if (!vs.ok) {
              log('register_reject', { code: vs.code });
              writeWsText(socket, { ok: false, error: { code: vs.code, reason: vs.reason } });
              continue;
            }

            const node_id = vn.value;
            const session_id = vs.value;
            const k = regKey(node_id, session_id);

            const prev = entries.get(k);
            if (prev && prev.socket !== socket) {
              // Deterministic replacement: same (node_id, session_id) registers again.
              try {
                writeWsText(prev.socket, { ok: false, type: 'replaced', node_id, session_id });
                prev.socket.end();
              } catch {
                // ignore
              }
            }

            reg = { node_id, session_id };
            entries.set(k, {
              node_id,
              session_id,
              socket,
              connected_at: nowIso(),
              last_seen: nowIso()
            });
            latestByNode.set(node_id, session_id);

            log('register_ok', { node_id, session_id });
            trace({ event: 'register', from: node_id, to: null, trace_id: null, kind: null });
            writeWsText(socket, { ok: true, type: 'registered', node_id, session_id });
            continue;
          }

          if (msg.type === 'relay') {
            if (!reg) {
              const trace_id = msg.trace_id ?? null;
              const kind = msg.payload?.kind ?? null;
              trace({ event: 'dropped_invalid', trace_id, from: null, to: msg.to ?? null, kind });
              writeWsText(socket, { ok: false, error: { code: 'NOT_REGISTERED', reason: 'must register first' } });
              writeWsText(socket, { type: 'ack', trace_id, status: 'dropped_invalid', reason: 'NOT_REGISTERED' });
              trace({ event: 'ack', trace_id, from: null, to: msg.to ?? null, kind: 'dropped_invalid' });
              continue;
            }

            // Update last_seen.
            const k = regKey(reg.node_id, reg.session_id);
            const cur = entries.get(k);
            if (cur && cur.socket === socket) cur.last_seen = nowIso();

            const toRaw = typeof msg.to === 'string' ? msg.to.trim() : '';
            if (!toRaw) {
              const trace_id = msg.trace_id ?? null;
              const kind = msg.payload?.kind ?? null;
              trace({ event: 'dropped_invalid', trace_id, from: reg.node_id, to: null, kind });
              writeWsText(socket, { ok: false, error: { code: 'INVALID_TO', reason: 'to required' } });
              writeWsText(socket, { type: 'ack', trace_id, status: 'dropped_invalid', reason: 'INVALID_TO' });
              trace({ event: 'ack', trace_id, from: reg.node_id, to: null, kind: 'dropped_invalid' });
              continue;
            }

            const trace_id = msg.trace_id ?? null;
            const kind = msg.payload?.kind ?? null;

            trace({ event: 'relay_received', trace_id, from: reg.node_id, to: toRaw, kind });

            // Minimal deterministic routing in v2 registration phase:
            // - to='node_id' routes to the latest session for that node_id.
            const toNode = toRaw;
            const toSession = latestByNode.get(toNode) || null;
            if (!toSession) {
              trace({ event: 'dropped_no_target', trace_id, from: reg.node_id, to: toNode, kind });
              writeWsText(socket, { ok: true, type: 'dropped', to: toNode });
              writeWsText(socket, { type: 'ack', trace_id, status: 'dropped_no_target', reason: 'NO_TARGET' });
              trace({ event: 'ack', trace_id, from: reg.node_id, to: toNode, kind: 'dropped_no_target' });
              continue;
            }

            const target = entries.get(regKey(toNode, toSession));
            if (!target || target.socket.destroyed) {
              trace({ event: 'dropped_no_target', trace_id, from: reg.node_id, to: toNode, kind });
              writeWsText(socket, { ok: true, type: 'dropped', to: toNode });
              writeWsText(socket, { type: 'ack', trace_id, status: 'dropped_no_target', reason: 'NO_TARGET' });
              trace({ event: 'ack', trace_id, from: reg.node_id, to: toNode, kind: 'dropped_no_target' });
              continue;
            }

            writeWsText(target.socket, { from: reg.node_id, payload: msg.payload ?? null });
            trace({ event: 'forwarded', trace_id, from: reg.node_id, to: toNode, kind });
            writeWsText(socket, { ok: true, type: 'relayed', to: toNode });
            writeWsText(socket, { type: 'ack', trace_id, status: 'forwarded', reason: null });
            trace({ event: 'ack', trace_id, from: reg.node_id, to: toNode, kind: 'forwarded' });
            continue;
          }
        }
      });

      socket.on('close', cleanup);
      socket.on('end', cleanup);
      socket.on('error', cleanup);
    } catch {
      try { socket.destroy(); } catch {}
    }
  });

  let boundAddress = null;

  return {
    start: async () =>
      new Promise((resolve) =>
        server.listen(port, bindHost, () => {
          boundAddress = server.address();
          resolve();
        })
      ),
    address: () => boundAddress,
    close: async () => new Promise((resolve) => server.close(() => resolve()))
  };
}
