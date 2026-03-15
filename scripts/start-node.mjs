import { startRuntimeNode } from '../src/runtime/node/runtimeNode.mjs';
import { startRuntimeNodeFormal } from '../src/runtime/node/runtimeNodeFormal.mjs';
import { createHttpTransport } from '../src/runtime/transport/httpTransport.mjs';
import { createFetchHttpClient } from '../src/runtime/bootstrap/bootstrapClient.mjs';
import { runNodeAutoJoin } from '../src/runtime/bootstrap/nodeAutoJoin.mjs';
import { createRelayClient } from '../src/runtime/transport/relayClient.mjs';
import { createRelayInboundHandler } from '../src/runtime/transport/relayInboundHandler.mjs';

function envBool(name, def = false) {
  const v = process.env[name];
  if (v == null) return def;
  return String(v).toLowerCase() === 'true';
}

const PORT = Number(process.env.PORT || 3000);
const RUNTIME_MODE = process.env.RUNTIME_MODE || 'formal';

// Minimal file-less storage (demo): in-memory only.
// Real persistence wiring is environment-specific and intentionally out of scope here.
const sessions = new Map();
const storage = {
  async readSession(session_id) {
    return sessions.get(session_id) ?? null;
  },
  async writeSession(session_id, state) {
    sessions.set(session_id, state);
  },
  async readFriends() {
    return [];
  },
  async writeFriends() {
    // no-op in the starter; friendship persistence requires explicit wiring
  }
};

// Fail-closed placeholder processor: this starter does not ship a full runtime wiring of crypto/transport.
const protocolProcessor = {
  async processInbound() {
    const err = new Error('Runtime starter: protocolProcessor not wired (fail closed)');
    err.code = 'RUNTIME_NOT_CONFIGURED';
    throw err;
  }
};

const probeEngine = null;
const friendshipTrigger = null;
const friendshipWriter = null;
const auditBinder = null;

const transport = createHttpTransport();

const BOOTSTRAP_PRIMARY = process.env.BOOTSTRAP_PRIMARY || 'https://gw.bothook.me';
const BOOTSTRAP_FALLBACK = process.env.BOOTSTRAP_FALLBACK || 'https://bootstrap.a2a.fun';

const runtimeOptions = {
  allowTestStubOutbound: envBool('ALLOW_TEST_STUB_OUTBOUND', false),
  enableFormalOutbound: envBool('ENABLE_FORMAL_OUTBOUND', false),
  formalOutboundUrl: process.env.FORMAL_OUTBOUND_URL || ''
};

// Bootstrap logic (minimal + explicit; NOT discovery):
// - try primary first
// - only try fallback if fallback DNS resolves
await announceBootstrapPlan({ primary: BOOTSTRAP_PRIMARY, fallback: BOOTSTRAP_FALLBACK });

// Optional node auto-join flow (explicit bootstrap join; NOT discovery).
if (envBool('ENABLE_AUTO_JOIN', false)) {
  // Fail closed on missing/invalid SELF_NODE_URL.
  // Do NOT attempt to guess the node URL.
  const selfNodeUrl = process.env.SELF_NODE_URL;
  if (!selfNodeUrl) {
    throw new Error('Auto-join misconfigured: ENABLE_AUTO_JOIN=true but SELF_NODE_URL missing');
  }

  const maxPeers = Number(process.env.MAX_BOOTSTRAP_PEERS || 3);
  const httpClient = createFetchHttpClient({ timeoutMs: 5000 });
  const res = await runNodeAutoJoin({
    selfNodeUrl,
    bootstrapPrimary: BOOTSTRAP_PRIMARY,
    bootstrapFallback: BOOTSTRAP_FALLBACK,
    maxPeers,
    httpClient
  });
  console.log(`Auto-join result: ${JSON.stringify(res)}`);
}

const identity = {
  node_name: process.env.NODE_NAME || 'a2a-node'
};

// Optional relay inbound wiring (v0.1): listen for forwarded relay payloads and apply AGENT_HANDSHAKE.
// Disabled by default to avoid changing unrelated deployments.
if (envBool('ENABLE_RELAY_INBOUND', false)) {
  const relayUrl = process.env.RELAY_URL || 'wss://bootstrap.a2a.fun/relay';
  const nodeId = process.env.NODE_ID || process.env.A2A_AGENT_ID || process.env.NODE_NAME || 'a2a-node';
  const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();

  const handleForward = createRelayInboundHandler({ workspace_path });

  const relayClient = createRelayClient({
    relayUrl,
    nodeId,
    registrationMode: 'v2',
    sessionId: `sess:${nodeId}`,
    onForward: ({ from, payload }) => {
      // best-effort: do not crash the node on handler errors
      handleForward({ from, payload }).catch(() => {});
    }
  });

  relayClient.connect().then(
    () => console.log(JSON.stringify({ ok: true, event: 'RELAY_INBOUND_CONNECTED', relayUrl, nodeId })),
    () => console.log(JSON.stringify({ ok: false, event: 'RELAY_INBOUND_CONNECT_FAILED', relayUrl, nodeId }))
  );
}

let node;
if (RUNTIME_MODE === 'formal') {
  node = await startRuntimeNodeFormal({
    port: PORT,
    storage,
    identity,
    deps: {
      protocolProcessor,
      probeEngine,
      friendshipTrigger,
      friendshipWriter,
      auditBinder,
      transport,
      runtimeOptions
    }
  });
} else {
  node = await startRuntimeNode({
    port: PORT,
    storage,
    identity,
    deps: { protocolProcessor, transport }
  });
}

console.log(`A2A-FUN runtime listening on port ${node.port} (mode=${RUNTIME_MODE})`);

async function announceBootstrapPlan({ primary, fallback }) {
  // This starter does not implement a networked bootstrap protocol.
  // We only announce the explicit endpoint plan and gate fallback attempts on DNS resolution.
  const primaryUrl = safeUrl(primary);
  const fallbackUrl = safeUrl(fallback);

  console.log(`Bootstrap primary: ${primaryUrl.origin}`);

  const fallbackOk = await dnsResolves(fallbackUrl.hostname);
  if (fallbackOk) {
    console.log(`Bootstrap fallback (DNS ok): ${fallbackUrl.origin}`);
  } else {
    console.log(`Bootstrap fallback inactive (DNS unresolved): ${fallbackUrl.origin}`);
  }
}

function safeUrl(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('invalid protocol');
    return url;
  } catch {
    // Keep output machine-safe and deterministic.
    return new URL('https://invalid.local');
  }
}

async function dnsResolves(hostname) {
  try {
    const dns = await import('node:dns/promises');
    // Prefer A lookup; AAAA can be added later.
    const r = await dns.resolve4(hostname);
    return Array.isArray(r) && r.length > 0;
  } catch {
    return false;
  }
}
