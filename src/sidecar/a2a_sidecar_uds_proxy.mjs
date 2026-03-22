#!/usr/bin/env node
// A2A Sidecar UDS Proxy (PoC)
// Listens on a Unix domain socket and forwards /a2a/request to an HTTP sidecar.
// Endpoints:
// - GET /healthz
// - POST /a2a/request

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

function nowIso() { return new Date().toISOString(); }

function readBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        try { req.destroy(); } catch {}
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

async function main() {
  const sock = process.env.A2A_SOCK || path.join(process.env.HOME || '/tmp', '.openclaw', 'a2a', 'sidecar.sock');
  const upstream = (process.env.A2A_HTTP_SIDECAR_URL || 'http://127.0.0.1:17890').replace(/\/$/, '');

  // ensure parent dir
  fs.mkdirSync(path.dirname(sock), { recursive: true });
  // cleanup existing socket
  try { fs.unlinkSync(sock); } catch {}

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/healthz') {
        return sendJson(res, 200, { ok: true, ts: nowIso(), sock, upstream });
      }

      if (req.method === 'POST' && req.url === '/a2a/request') {
        const buf = await readBody(req);
        const r = await fetch(upstream + '/a2a/request', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: buf,
        });
        const txt = await r.text();
        res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(txt);
        return;
      }

      return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND' } });
    } catch (e) {
      return sendJson(res, 200, { ok: false, error: { code: 'UDS_PROXY_ERROR', message: String(e?.message || e) } });
    }
  });

  server.listen(sock, () => {
    console.log(JSON.stringify({ ok: true, event: 'A2A_UDS_LISTENING', ts: nowIso(), sock, upstream }));
  });

  const shutdown = () => {
    try { server.close(); } catch {}
    try { fs.unlinkSync(sock); } catch {}
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, event: 'A2A_UDS_FATAL', ts: nowIso(), error: String(e?.message || e) }));
  process.exit(1);
});
