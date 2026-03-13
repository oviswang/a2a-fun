import { startRuntimeNode } from '../src/runtime/node/runtimeNode.mjs';
import { startRuntimeNodeFormal } from '../src/runtime/node/runtimeNodeFormal.mjs';
import { createHttpTransport } from '../src/runtime/transport/httpTransport.mjs';

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

const identity = {
  node_name: process.env.NODE_NAME || 'a2a-node'
};

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
