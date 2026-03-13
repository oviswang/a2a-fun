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
  // text frame, no mask
  const header = [];
  header.push(0x81);
  if (payload.length < 126) {
    header.push(payload.length);
  } else if (payload.length < 65536) {
    header.push(126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  } else {
    // This relay only supports small control messages.
    return;
  }
  socket.write(Buffer.concat([Buffer.from(header), payload]));
}

function readWsFrames(buffer) {
  // Minimal parser for masked client->server frames.
  // Supports: text (0x1), ping (0x9), pong (0xA), close (0x8).
  // Returns { frames: { opcode, payload: Buffer }[], rest: Buffer }
  const frames = [];
  let off = 0;

  while (off + 2 <= buffer.length) {
    const b0 = buffer[off];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    if (!fin) break; // no fragmentation support

    const b1 = buffer[off + 1];
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let hdrLen = 2;

    if (len === 126) {
      if (off + 4 > buffer.length) break;
      len = (buffer[off + 2] << 8) | buffer[off + 3];
      hdrLen = 4;
    } else if (len === 127) {
      // not supported
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

    if (opcode === 0x8) break; // close
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

export function createRelayServer({ bindHost = '127.0.0.1', port = 3110, wsPath = '/relay' } = {}) {
  // node_id -> socket
  const nodes = new Map();

  const server = http.createServer((req, res) => {
    // No HTTP surface.
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

      let nodeId = null;
      let buf = Buffer.alloc(0);

      function cleanup() {
        if (nodeId && nodes.get(nodeId) === socket) nodes.delete(nodeId);
        nodeId = null;
      }

      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const { frames, rest } = readWsFrames(buf);
        buf = rest;

        for (const fr of frames) {
          if (fr.opcode === 0x8) {
            // close
            cleanup();
            try {
              socket.end();
            } catch {
              // ignore
            }
            continue;
          }
          if (fr.opcode === 0x9) {
            // ping
            writeWsPong(socket, fr.payload);
            continue;
          }
          if (fr.opcode !== 0x1) continue; // only text messages carry protocol

          const raw = fr.payload.toString('utf8');
          const msg = safeJsonParse(raw);
          if (!msg || typeof msg !== 'object') continue;

          if (msg.type === 'register') {
            const n = typeof msg.node === 'string' ? msg.node.trim() : '';
            if (!n) {
              writeWsText(socket, { ok: false, error: { code: 'INVALID_NODE', reason: 'node_id required' } });
              continue;
            }
            nodeId = n;
            nodes.set(nodeId, socket);
            writeWsText(socket, { ok: true, type: 'registered', node: nodeId });
            continue;
          }

          if (msg.type === 'relay') {
            if (!nodeId) {
              writeWsText(socket, { ok: false, error: { code: 'NOT_REGISTERED', reason: 'must register first' } });
              continue;
            }
            const to = typeof msg.to === 'string' ? msg.to.trim() : '';
            if (!to) {
              writeWsText(socket, { ok: false, error: { code: 'INVALID_TO', reason: 'to required' } });
              continue;
            }
            const target = nodes.get(to);
            if (!target || target.destroyed) {
              // drop (no queue/retry)
              writeWsText(socket, { ok: true, type: 'dropped', to });
              continue;
            }

            writeWsText(target, { from: nodeId, payload: msg.payload ?? null });
            writeWsText(socket, { ok: true, type: 'relayed', to });
            continue;
          }
        }
      });

      socket.on('close', cleanup);
      socket.on('end', cleanup);
      socket.on('error', cleanup);
    } catch {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
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
