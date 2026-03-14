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
            writeWsText(socket, { ok: true, type: 'registered', node_id, session_id });
            continue;
          }

          if (msg.type === 'relay') {
            if (!reg) {
              writeWsText(socket, { ok: false, error: { code: 'NOT_REGISTERED', reason: 'must register first' } });
              continue;
            }

            // Update last_seen.
            const k = regKey(reg.node_id, reg.session_id);
            const cur = entries.get(k);
            if (cur && cur.socket === socket) cur.last_seen = nowIso();

            const toRaw = typeof msg.to === 'string' ? msg.to.trim() : '';
            if (!toRaw) {
              writeWsText(socket, { ok: false, error: { code: 'INVALID_TO', reason: 'to required' } });
              continue;
            }

            // Minimal deterministic routing in v2 registration phase:
            // - to='node_id' routes to the latest session for that node_id.
            const toNode = toRaw;
            const toSession = latestByNode.get(toNode) || null;
            if (!toSession) {
              writeWsText(socket, { ok: true, type: 'dropped', to: toNode });
              continue;
            }

            const target = entries.get(regKey(toNode, toSession));
            if (!target || target.socket.destroyed) {
              writeWsText(socket, { ok: true, type: 'dropped', to: toNode });
              continue;
            }

            writeWsText(target.socket, { from: reg.node_id, payload: msg.payload ?? null });
            writeWsText(socket, { ok: true, type: 'relayed', to: toNode });
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
