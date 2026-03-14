import http from 'node:http';

import * as officialCapabilities from '../../../examples/capabilities/index.mjs';
import { listCapabilities } from '../../capability/capabilityDiscoveryList.mjs';
import { getNodeStatus } from '../status/nodeStatus.mjs';

import { createNetworkAgentDirectory, publishAgentCard, listPublishedAgents, searchPublishedAgents } from '../../discovery/networkAgentDirectory.mjs';
import { createNetworkAgentDirectoryEntry } from '../../discovery/networkAgentDirectoryEntry.mjs';

export function createHttpTransport() {
  const directory = createNetworkAgentDirectory();
  /**
   * Start an HTTP server.
   * Minimal receive endpoint:
   * - POST /message
   * - body: JSON { envelope }
   */
  async function startServer({ port = 0, onMessage }) {
    if (typeof onMessage !== 'function') throw new Error('httpTransport: missing onMessage');

    const server = http.createServer(async (req, res) => {
      try {
        if (req.method === 'GET' && req.url === '/capabilities') {
          const out = listCapabilities({ registry: officialCapabilities });
          if (!out.ok) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: out.error?.code || 'FAIL_CLOSED' }));
            return;
          }

          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              ok: true,
              node_id: null,
              capabilities: out.capabilities
            })
          );
          return;
        }

        if (req.method === 'GET' && req.url === '/status') {
          const capsOut = listCapabilities({ registry: officialCapabilities });
          const statusOut = getNodeStatus({
            node_id: null,
            relay_connected: false,
            capabilities: capsOut.ok ? capsOut.capabilities : [],
            peers: [],
            friendships: []
          });

          // Fail closed to safe defaults if anything is invalid/unavailable.
          const safe = statusOut.ok
            ? statusOut
            : getNodeStatus({ node_id: null, relay_connected: false, capabilities: [], peers: [], friendships: [] });

          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(safe));
          return;
        }

        if (req.method === 'GET' && req.url === '/agents') {
          const out = listPublishedAgents({ directory });
          if (!out.ok) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: out.error?.code || 'FAIL_CLOSED' }));
            return;
          }
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, agents: out.agents }));
          return;
        }

        if (req.method === 'GET' && typeof req.url === 'string' && req.url.startsWith('/agents/search')) {
          const u = new URL(req.url, 'http://127.0.0.1');
          const q = u.searchParams.get('q') || '';
          const out = searchPublishedAgents({ directory, query: q });
          if (!out.ok) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: out.error?.code || 'FAIL_CLOSED' }));
            return;
          }
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, results: out.results }));
          return;
        }

        if (req.method === 'POST' && req.url === '/agents/publish') {
          const raw = await readBody(req, 256 * 1024);
          let json;
          try {
            json = JSON.parse(raw);
          } catch {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'BAD_JSON' }));
            return;
          }

          const entryOut = createNetworkAgentDirectoryEntry({
            agent_id: json?.agent_id,
            published_at: new Date().toISOString(),
            card: json?.card
          });
          if (!entryOut.ok) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: entryOut.error?.code || 'FAIL_CLOSED' }));
            return;
          }

          const pubOut = publishAgentCard({ directory, entry: entryOut.entry });
          if (!pubOut.ok) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: pubOut.error?.code || 'FAIL_CLOSED' }));
            return;
          }

          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, published: true, agent_id: entryOut.entry.agent_id }));
          return;
        }

        if (req.method !== 'POST' || req.url !== '/message') {
          res.statusCode = 404;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
          return;
        }

        const raw = await readBody(req, 256 * 1024);
        let json;
        try {
          json = JSON.parse(raw);
        } catch {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'BAD_JSON' }));
          return;
        }

        const out = await onMessage({ envelope: json.envelope, raw: json });

        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, out }));
      } catch (e) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'FAIL_CLOSED', message: String(e.message || e) }));
      }
    });

    await new Promise((resolve) => server.listen(port, resolve));
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;

    return {
      port: actualPort,
      close: async () => new Promise((resolve) => server.close(() => resolve()))
    };
  }

  /**
   * Minimal send:
   * - POST to peer endpoint
   * - JSON { envelope }
   */
  async function send({ url, envelope }) {
    if (!url) throw new Error('httpTransport.send: missing url');
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ envelope })
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      const err = new Error(`httpTransport.send: non-2xx (${r.status})`);
      err.code = 'TRANSPORT_NON_2XX';
      err.meta = { status: r.status, body: t.slice(0, 256) };
      throw err;
    }
    return r.json().catch(() => ({ ok: true }));
  }

  return { startServer, send };
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > maxBytes) {
        reject(new Error('httpTransport: request too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
