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

const runtimeOptions = {
  allowTestStubOutbound: envBool('ALLOW_TEST_STUB_OUTBOUND', false),
  enableFormalOutbound: envBool('ENABLE_FORMAL_OUTBOUND', false),
  formalOutboundUrl: process.env.FORMAL_OUTBOUND_URL || ''
};

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
