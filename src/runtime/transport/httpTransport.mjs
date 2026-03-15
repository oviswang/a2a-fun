import http from 'node:http';
import os from 'node:os';

import * as officialCapabilities from '../../../examples/capabilities/index.mjs';
import { listCapabilities } from '../../capability/capabilityDiscoveryList.mjs';
import { getNodeStatus } from '../status/nodeStatus.mjs';

import { createNetworkAgentDirectory, publishAgentCard, listPublishedAgents, searchPublishedAgents } from '../../discovery/networkAgentDirectory.mjs';
import { createNetworkAgentDirectoryEntry } from '../../discovery/networkAgentDirectoryEntry.mjs';
import { publishLocalAgentCardRuntime } from '../../discovery/networkAgentPublishRuntime.mjs';
import { extractAgentDiscoveryDocuments } from '../../discovery/agentDocumentExtractor.mjs';
import { buildAgentCardFromDocuments } from '../../discovery/agentCardBuilder.mjs';
import { introspectLocalCapabilities } from '../../discovery/agentCapabilityIntrospector.mjs';
import { publishAgentCardRemote, listPublishedAgentsRemote } from '../../discovery/sharedAgentDirectoryClient.mjs';
import { resolveStableAgentIdentity } from '../../identity/stableIdentityRuntime.mjs';
import { handleInterestDecision } from '../../social/agentInterestDecisionHandler.mjs';

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

        if (req.method === 'POST' && req.url === '/agents/publish-self') {
          const workspace_path = process.env.A2A_WORKSPACE_PATH || '';
          const envLegacyAgentId = (process.env.A2A_AGENT_ID || '').trim();
          const fallback_agent_id = envLegacyAgentId || os.hostname();

          // Optional runtime context (best-effort) can be supplied in the request body.
          // Backward-compatible: empty body is allowed.
          let runtimeContext = null;
          try {
            const raw = await readBody(req, 16 * 1024);
            if (raw && raw.trim()) {
              const parsed = JSON.parse(raw);
              runtimeContext = parsed?.context && typeof parsed.context === 'object' ? parsed.context : parsed;
            }
          } catch {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'BAD_JSON' }));
            return;
          }

          // Priority 1: explicit env principal hints.
          const envPrincipalGateway = (process.env.A2A_PRINCIPAL_GATEWAY || '').trim();
          const envPrincipalAccountId = (process.env.A2A_PRINCIPAL_ACCOUNT_ID || '').trim();

          // Priority 2: runtime context hints.
          const ctx = runtimeContext && typeof runtimeContext === 'object' ? runtimeContext : {};

          const candidateContext = envPrincipalGateway && envPrincipalAccountId
            ? { gateway: envPrincipalGateway, account_id: envPrincipalAccountId }
            : {
                gateway: ctx.gateway || ctx.channel || process.env.A2A_SOCIAL_GATEWAY || process.env.A2A_GATEWAY || process.env.A2A_CHANNEL || null,
                account_id: ctx.account_id || ctx.chat_id || ctx.channel_id || process.env.A2A_SOCIAL_CHANNEL_ID || process.env.A2A_CHAT_ID || null,
                chat_id: ctx.chat_id || null,
                channel_id: ctx.channel_id || null
              };

          // Priority 3: gateway adapters (best-effort) — not implemented in v0.1.

          let agent_id = fallback_agent_id;
          let stable_identity = false;
          let legacy_fallback = true;

          try {
            const stable = resolveStableAgentIdentity({ context: candidateContext, agent_slug: 'default' });
            if (stable.ok && typeof stable.stable_agent_id === 'string' && stable.stable_agent_id) {
              agent_id = stable.stable_agent_id;
              stable_identity = true;
              legacy_fallback = false;
              console.log(JSON.stringify({ ok: true, event: 'stable_identity_resolved', principal_source: stable.principal_source, stable_agent_id: stable.stable_agent_id }));
            } else {
              console.log(JSON.stringify({ ok: true, event: 'stable_identity_unresolved', fallback_legacy_agent_id: fallback_agent_id }));
            }
          } catch {
            console.log(JSON.stringify({ ok: true, event: 'stable_identity_unresolved', fallback_legacy_agent_id: fallback_agent_id }));
          }

          // Build local AgentCard once.
          const docsOut = await extractAgentDiscoveryDocuments({ workspace_path });
          if (!docsOut.ok) {
            const out = { ok: false, published: false, agent_id: null, local_published: false, remote_published: false, error: docsOut.error };
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(out));
            return;
          }

          // Best-effort capability introspection from local /capabilities.
          let caps = [];
          try {
            const localPort = req?.socket?.localPort;
            const capBase = typeof localPort === 'number' && localPort > 0 ? `http://127.0.0.1:${localPort}` : 'http://127.0.0.1:3000';
            const capOut = await introspectLocalCapabilities({ base_url: capBase });
            if (capOut.ok === true && Array.isArray(capOut.capabilities)) caps = capOut.capabilities;
          } catch {
            caps = [];
          }

          const cardOut = buildAgentCardFromDocuments({ documents: docsOut.documents, agent_id, capabilities: caps });
          if (!cardOut.ok) {
            const out = { ok: false, published: false, agent_id: agent_id || null, local_published: false, remote_published: false, error: cardOut.error };
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(out));
            return;
          }

          // Publish locally (deterministic).
          const entryOut = createNetworkAgentDirectoryEntry({
            agent_id,
            published_at: new Date().toISOString(),
            card: cardOut.agent_card
          });

          if (!entryOut.ok) {
            const out = { ok: false, published: false, agent_id: agent_id || null, local_published: false, remote_published: false, error: entryOut.error };
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(out));
            return;
          }

          const localOut = publishAgentCard({ directory, entry: entryOut.entry });
          const local_published = localOut.ok === true;

          // Best-effort remote publish to bootstrap-backed shared directory.
          // Mark remote_published=true only if publish succeeds AND agent becomes visible in remote /agents.
          let remote_published = false;
          try {
            const remoteOut = await publishAgentCardRemote({
              base_url: 'https://bootstrap.a2a.fun',
              agent_id: entryOut.entry.agent_id,
              card: cardOut.agent_card
            });

            if (remoteOut.ok === true) {
              const listOut = await listPublishedAgentsRemote({ base_url: 'https://bootstrap.a2a.fun' });
              if (listOut.ok === true && Array.isArray(listOut.agents)) {
                remote_published = listOut.agents.some((a) => a && a.agent_id === entryOut.entry.agent_id);
              }
            }
          } catch {
            remote_published = false;
          }

          const out = {
            ok: local_published,
            published: local_published,
            agent_id: entryOut.entry.agent_id,
            stable_identity,
            legacy_fallback,
            legacy_agent_id: fallback_agent_id,
            local_published,
            remote_published,
            error: local_published ? null : (localOut.error || { code: 'LOCAL_PUBLISH_FAILED' })
          };

          res.statusCode = local_published ? 200 : 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(out));
          return;
        }

        // Human decision endpoint (v0.1): interest prompt reply handling.
        // Body: { peer_agent_id, text }
        if (req.method === 'POST' && req.url === '/interest/reply') {
          const raw = await readBody(req, 8 * 1024);
          let json;
          try { json = JSON.parse(raw); } catch {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'BAD_JSON' }));
            return;
          }

          const peer_agent_id = json?.peer_agent_id;
          const text = json?.text;
          const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();

          const out = await handleInterestDecision({ workspace_path, peer_agent_id, text });
          res.statusCode = out.ok ? 200 : 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(out));
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

        // Optional human inbound mapping (v0.1): if body contains {text:"1"|"2"} treat it as an interest decision.
        if (typeof json?.text === 'string' && !json?.envelope) {
          const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();
          console.log(JSON.stringify({ ok: true, event: 'AGENT_INTEREST_REPLY_RECEIVED', text: String(json.text).trim() }));
          const dec = await handleInterestDecision({ workspace_path, peer_agent_id: json?.peer_agent_id, text: json.text });
          if (dec.ok) console.log(JSON.stringify({ ok: true, event: 'AGENT_INTEREST_REPLY_APPLIED', decision: dec.decision }));

          res.statusCode = dec.ok ? 200 : 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(dec));
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
