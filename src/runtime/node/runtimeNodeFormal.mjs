import { createHttpTransport } from '../transport/httpTransport.mjs';
import { createMessageRouterFormal } from '../router/messageRouterFormal.mjs';

/**
 * startRuntimeNodeFormal(...)
 *
 * Positioning (important):
 * - This is ONLY a Phase 7 formal outbound integration VARIANT for the runtime wiring.
 * - It is NOT a replacement for the frozen Phase 6 runtime node.
 * - It is NOT a new protocol phase; it only wires Phase 7 egress builder into runtime.
 * - The original Phase 6 runtime remains valid and unchanged.
 */
export async function startRuntimeNodeFormal({ port = 0, storage, identity, deps = {} }) {
  if (!storage) throw new Error('runtimeNodeFormal: missing storage');
  if (!identity) throw new Error('runtimeNodeFormal: missing identity');

  const transport = deps.transport ?? createHttpTransport();

  const router = createMessageRouterFormal({
    protocolProcessor: deps.protocolProcessor,
    probeEngine: deps.probeEngine,
    friendshipTrigger: deps.friendshipTrigger,
    friendshipWriter: deps.friendshipWriter,
    storage,
    transport,
    auditBinder: deps.auditBinder,
    runtimeOptions: deps.runtimeOptions ?? {},
    formalOutboundBuilder: deps.formalOutboundBuilder
  });

  const server = await transport.startServer({
    port,
    onMessage: async ({ envelope }) => router.handleRemoteEnvelope({ envelope })
  });

  return { port: server.port, close: server.close };
}
