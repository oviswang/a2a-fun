import http from 'node:http';
import crypto from 'node:crypto';

function nowIso() {
  return new Date().toISOString();
}

function log(event, fields = {}) {
  // machine-safe JSONL
  // mandatory: event, ts
  process.stdout.write(`${JSON.stringify({ ok: true, event, ts: nowIso(), ...fields })}\n`);
}

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
    // v0.1: keep relay minimal
    return;
  }
  socket.write(Buffer.concat([Buffer.from(header), payload]));
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

function closeSocket(socket) {
  try {
    socket.end();
  } catch {}
  try {
    socket.destroy();
  } catch {}
}

function isNodeId(x) {
  return typeof x === 'string' && x.trim().length > 0 && x.trim().length <= 120;
}

export function createRelayCoreV0_1({ bindHost = '0.0.0.0', port = 18884, wsPath = '/relay' } = {}) {
  // node_id -> { socket, lastSeenMs, conn_id, remote, ua }
  const conns = new Map();
  // socket -> node_id
  const socketToNode = new Map();
  // socket -> { conn_id, remote, ua }
  const socketMeta = new Map();

  const IDLE_TIMEOUT_MS = Number(process.env.RELAY_IDLE_TIMEOUT_MS || 90_000);
  const SWEEP_INTERVAL_MS = Number(process.env.RELAY_SWEEP_INTERVAL_MS || 10_000);

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, service: 'a2a-relay', protocol: 'a2a/0.1' }));
      return;
    }
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', reason: 'unknown endpoint' } }));
  });

  server.on('upgrade', (req, socket) => {
    try {
      const u = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      if (u.pathname !== wsPath) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        closeSocket(socket);
        return;
      }

      const key = req.headers['sec-websocket-key'];
      if (!key) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        closeSocket(socket);
        return;
      }

      const accept = wsAccept(key);
      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${accept}`,
          '\r\n'
        ].join('\r\n')
      );

      const conn_id = crypto.randomUUID();
      const remote = socket.remoteAddress || null;
      const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
      const xff = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : null;
      const xri = typeof req.headers['x-real-ip'] === 'string' ? req.headers['x-real-ip'] : null;
      const cf = typeof req.headers['cf-connecting-ip'] === 'string' ? req.headers['cf-connecting-ip'] : null;
      socketMeta.set(socket, { conn_id, remote, ua, xff, xri, cf });

      log('RELAY_CONNECTION_OPEN', { node_id: null, conn_id, remote, xff, xri, cf, ua });

      let buf = Buffer.alloc(0);
      let closed = false;

      const touch = () => {
        const node_id = socketToNode.get(socket) || null;
        if (node_id && conns.has(node_id)) {
          conns.set(node_id, { socket, lastSeenMs: Date.now() });
        }
      };

      const disconnect = (reason = 'socket_closed') => {
        if (closed) return;
        closed = true;
        const node_id = socketToNode.get(socket);
        const meta = socketMeta.get(socket) || {};
        if (node_id) {
          socketToNode.delete(socket);
          const cur = conns.get(node_id);
          // only delete if it is the same active socket
          if (cur && cur.socket === socket) conns.delete(node_id);
          log('RELAY_NODE_DISCONNECTED', {
            node_id,
            conn_id: meta.conn_id || null,
            remote: meta.remote || null,
            xff: meta.xff || null,
            xri: meta.xri || null,
            cf: meta.cf || null,
            ua: meta.ua || null,
            reason
          });
        } else {
          log('RELAY_NODE_DISCONNECTED', {
            node_id: null,
            conn_id: meta.conn_id || null,
            remote: meta.remote || null,
            xff: meta.xff || null,
            xri: meta.xri || null,
            cf: meta.cf || null,
            ua: meta.ua || null,
            reason
          });
        }
        socketMeta.delete(socket);
        closeSocket(socket);
      };

      socket.on('data', (chunk) => {
        if (closed) return;
        buf = Buffer.concat([buf, chunk]);
        const { frames, rest } = readWsFrames(buf);
        buf = rest;

        for (const f of frames) {
          // ping
          if (f.opcode === 0x9) {
            writeWsPong(socket, f.payload);
            touch();
            continue;
          }
          // close
          if (f.opcode === 0x8) {
            disconnect('ws_close');
            return;
          }
          // text
          if (f.opcode !== 0x1) continue;

          touch();
          const msg = safeJsonParse(f.payload.toString('utf8'));
          if (!msg || typeof msg !== 'object') {
            writeWsText(socket, { type: 'ERROR', error: 'BAD_JSON' });
            continue;
          }

          // REGISTER
          if (msg.type === 'REGISTER') {
            const node_id = String(msg.from || '').trim();
            if (!isNodeId(node_id)) {
              writeWsText(socket, { type: 'REGISTER_ACK', to: null, accepted: false, error: 'INVALID_NODE_ID' });
              continue;
            }

            const metaNew = socketMeta.get(socket) || {};

            // Replace-old policy: if duplicate node_id exists, close old socket and accept new.
            const prev = conns.get(node_id);
            if (prev && prev.socket && prev.socket !== socket) {
              log('RELAY_CONNECTION_REPLACED', {
                node_id,
                old_conn_id: prev.conn_id || null,
                old_remote: prev.remote || null,
                old_xff: prev.xff || null,
                old_xri: prev.xri || null,
                old_cf: prev.cf || null,
                old_ua: prev.ua || null,
                new_conn_id: metaNew.conn_id || null,
                new_remote: metaNew.remote || null,
                new_xff: metaNew.xff || null,
                new_xri: metaNew.xri || null,
                new_cf: metaNew.cf || null,
                new_ua: metaNew.ua || null
              });
              try {
                writeWsText(prev.socket, { type: 'ERROR', error: 'REPLACED_BY_NEW_CONNECTION' });
              } catch {}
              try {
                prev.socket.end();
              } catch {}
              try {
                prev.socket.destroy();
              } catch {}
            }

            conns.set(node_id, {
              socket,
              lastSeenMs: Date.now(),
              conn_id: metaNew.conn_id || null,
              remote: metaNew.remote || null,
              xff: metaNew.xff || null,
              xri: metaNew.xri || null,
              cf: metaNew.cf || null,
              ua: metaNew.ua || null
            });
            socketToNode.set(socket, node_id);

            writeWsText(socket, { type: 'REGISTER_ACK', to: node_id, accepted: true });
            log('RELAY_REGISTER_OK', {
              node_id,
              conn_id: metaNew.conn_id || null,
              remote: metaNew.remote || null,
              xff: metaNew.xff || null,
              xri: metaNew.xri || null,
              cf: metaNew.cf || null,
              ua: metaNew.ua || null
            });
            continue;
          }

          // SEND
          if (msg.type === 'SEND') {
            const from = String(msg.from || '').trim();
            const to = String(msg.to || '').trim();
            const message_id = isNodeId(String(msg.message_id || '')) ? String(msg.message_id) : `msg:${crypto.randomUUID()}`;

            if (!isNodeId(from) || !isNodeId(to)) {
              writeWsText(socket, { type: 'ERROR', message_id, error: 'INVALID_FROM_TO' });
              continue;
            }

            const data = msg.data && typeof msg.data === 'object' ? msg.data : {};
            const topic = typeof data.topic === 'string' ? data.topic : null;
            const payload = data.payload ?? null;
            if (!topic || topic.length > 120) {
              writeWsText(socket, { type: 'ERROR', message_id, error: 'INVALID_TOPIC' });
              continue;
            }

            const target = conns.get(to);
            if (!target || !target.socket) {
              writeWsText(socket, { type: 'ERROR', message_id, error: 'NO_TARGET' });
              continue;
            }

            writeWsText(target.socket, {
              type: 'DELIVER',
              from,
              to,
              message_id,
              data: { topic, payload }
            });

            log('RELAY_MESSAGE_FORWARD', { node_id: from, to_node_id: to, message_id, topic });
            continue;
          }

          writeWsText(socket, { type: 'ERROR', error: 'UNKNOWN_TYPE' });
        }
      });

      socket.on('error', () => disconnect('socket_error'));
      socket.on('end', () => disconnect('socket_end'));
      socket.on('close', () => disconnect('socket_close'));
    } catch {
      try {
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      } catch {}
      closeSocket(socket);
    }
  });

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [node_id, info] of conns.entries()) {
      if (!info || !info.socket) {
        conns.delete(node_id);
        continue;
      }
      if (now - (info.lastSeenMs || 0) > IDLE_TIMEOUT_MS) {
        // idle: close
        try {
          writeWsText(info.socket, { type: 'ERROR', error: 'IDLE_TIMEOUT' });
        } catch {}
        closeSocket(info.socket);
        conns.delete(node_id);
        log('RELAY_NODE_DISCONNECTED', { node_id, reason: 'idle_timeout' });
      }
    }
  }, SWEEP_INTERVAL_MS);
  sweep.unref();

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
    close: async () => {
      clearInterval(sweep);
      for (const { socket } of conns.values()) closeSocket(socket);
      conns.clear();
      socketToNode.clear();
      await new Promise((resolve) => server.close(() => resolve()));
    }
  };
}
