import { createHttpTransport } from '../transport/httpTransport.mjs';
import { createMessageRouter } from '../router/messageRouter.mjs';

/**
 * Minimal runtime node (HTTP).
 *
 * start({ port, storage, identity, deps? })
 * - deps allows injecting protocol components for testing without touching frozen modules.
 */
export async function startRuntimeNode({ port = 0, storage, identity, deps = {} }) {
  if (!storage) throw new Error('runtimeNode: missing storage');
  if (!identity) throw new Error('runtimeNode: missing identity');

  const transport = deps.transport ?? createHttpTransport();

  const router = createMessageRouter({
    protocolProcessor: deps.protocolProcessor,
    probeEngine: deps.probeEngine,
    friendshipTrigger: deps.friendshipTrigger,
    friendshipWriter: deps.friendshipWriter,
    storage,
    transport,
    auditBinder: deps.auditBinder,
    runtimeOptions: deps.runtimeOptions ?? {}
  });

  const server = await transport.startServer({
    port,
    onMessage: async ({ envelope }) => {
      // In this minimal runtime, all inbound are treated as remote envelopes.
      return router.handleRemoteEnvelope({ envelope });
    }
  });

  return {
    port: server.port,
    close: server.close
  };
}
