#!/usr/bin/env node
/**
 * Minimal two-machine relay E2E harness for Remote Execution Runtime.
 *
 * Validates runtime path (via relay):
 * Machine A -> sendRemoteInvocation -> executeTransport(relay) -> relayServer -> Machine B relayInbound
 * -> handleRemoteInvocation -> (local Execution Runtime) -> sendRemoteInvocationResult -> executeTransport(relay)
 * -> relayServer -> Machine A relayInbound -> handleRemoteInvocationResult
 *
 * Hard constraints:
 * - does not modify transport/envelope/protocol/phase3 semantics
 * - no mailbox/orchestration/marketplace/retry
 * - uses the frozen primitives + the Remote Execution Runtime primitives
 *
 * Usage (run on separate machines):
 *   node scripts/remote_execution_two_machine_relay_e2e.mjs relay --host 0.0.0.0 --port 18884
 *   node scripts/remote_execution_two_machine_relay_e2e.mjs b --relayUrl ws://<relay-host>:18884/relay --nodeId nodeB --to nodeA
 *   node scripts/remote_execution_two_machine_relay_e2e.mjs a --relayUrl ws://<relay-host>:18884/relay --nodeId nodeA --to nodeB
 */

import { createRelayServer } from '../src/relay/relayServer.mjs';
import { createRelayClient } from '../src/runtime/transport/relayClient.mjs';
import { executeTransport } from '../src/runtime/transport/executeTransport.mjs';
import { handleRelayInbound } from '../src/runtime/inbound/relayInbound.mjs';

import { createCapabilityReference } from '../src/capability/capabilityReference.mjs';
import { createCapabilityInvocationRequest } from '../src/capability/capabilityInvocationRequest.mjs';
import { createCapabilityInvocationResult } from '../src/capability/capabilityInvocationResult.mjs';

import {
  createCapabilityHandlerRegistry,
  registerCapabilityHandler
} from '../src/execution/capabilityHandlerRegistry.mjs';

import { sendRemoteInvocation } from '../src/remote/remoteInvocationTransport.mjs';
import { handleRemoteInvocation } from '../src/remote/remoteExecutionEntry.mjs';
import {
  sendRemoteInvocationResult,
  handleRemoteInvocationResult
} from '../src/remote/remoteResultReturn.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    } else {
      out._.push(a);
    }
  }
  return out;
}

async function runRelay({ host = '127.0.0.1', port = 18884 } = {}) {
  const srv = createRelayServer({ bindHost: host, port: Number(port), wsPath: '/relay' });
  await srv.start();
  const addr = srv.address();
  const url = `ws://${addr.address}:${addr.port}/relay`;
  console.log(JSON.stringify({ ok: true, role: 'relay', relayUrl: url }));
}

function makeInvocationRequest({ friendship_id = 'fr_1', capability_id = 'cap_echo', payload = { msg: 'hi' } } = {}) {
  const friendship_record = { friendship_id, established: true };
  const capability_reference = createCapabilityReference({
    friendship_record,
    capability: { capability_id, name: capability_id, summary: capability_id }
  });
  return createCapabilityInvocationRequest({ capability_reference, payload });
}

async function runMachineB({ relayUrl, nodeId = 'nodeB', to = 'nodeA' } = {}) {
  if (!relayUrl) throw new Error('--relayUrl required');

  const friendship_record = { friendship_id: 'fr_1', established: true };

  const registry = createCapabilityHandlerRegistry();
  registerCapabilityHandler({
    registry,
    capability_id: 'cap_echo',
    handler: (payload) => ({ echoed: String(payload.msg || '') })
  });

  const client = createRelayClient({
    relayUrl,
    nodeId,
    onForward: async (msg) => {
      await handleRelayInbound(msg, {
        onInbound: async (payload) => {
          // payload here is opaque runtime payload (REMOTE_INVOCATION_REQUEST)
          const entryOut = handleRemoteInvocation({ payload, registry, friendship_record });

          const invocation_request = payload?.invocation_request;
          const invocation_id = invocation_request?.invocation_id ?? null;

          // For the E2E harness, always return a frozen invocation_result:
          // - if entry succeeded, use entryOut.invocation_result
          // - if entry failed, synthesize a failure invocation_result using frozen primitive
          const invocation_result = entryOut.ok
            ? entryOut.invocation_result
            : createCapabilityInvocationResult({
                invocation_request,
                ok: false,
                result: null,
                error: { code: entryOut.error.code }
              });

          // Send result back to Machine A via relay path.
          const unreachablePeerUrl = 'http://127.0.0.1:9/';
          await sendRemoteInvocationResult({
            transport: executeTransport,
            peer: {
              peerUrl: unreachablePeerUrl,
              relayAvailable: true,
              relayUrl,
              nodeId,
              relayTo: to
            },
            invocation_result
          });

          console.log(
            JSON.stringify({
              ok: true,
              role: 'machineB',
              from: msg.from,
              received_kind: payload?.kind ?? null,
              invocation_id,
              entry_ok: entryOut.ok,
              entry_error: entryOut.error,
              sent_result_ok: true
            })
          );

          return { ok: true };
        }
      });
    }
  });

  await client.connect();
  console.log(JSON.stringify({ ok: true, role: 'machineB', nodeId, connected: true }));
}

async function runMachineA({ relayUrl, nodeId = 'nodeA', to = 'nodeB' } = {}) {
  if (!relayUrl) throw new Error('--relayUrl required');

  const client = createRelayClient({
    relayUrl,
    nodeId,
    onForward: async (msg) => {
      await handleRelayInbound(msg, {
        onInbound: async (payload) => {
          const out = handleRemoteInvocationResult({ payload });
          console.log(
            JSON.stringify({
              ok: true,
              role: 'machineA',
              from: msg.from,
              received_kind: payload?.kind ?? null,
              recv_ok: out.ok,
              invocation_id: out.invocation_id,
              invocation_ok: out.invocation_result?.ok ?? null,
              invocation_error: out.invocation_result?.error ?? null,
              receive_error: out.error ?? null
            })
          );
          return { ok: true };
        }
      });
    }
  });

  await client.connect();
  console.log(JSON.stringify({ ok: true, role: 'machineA', nodeId, connected: true }));

  const unreachablePeerUrl = 'http://127.0.0.1:9/';

  // 1) Success path
  const invOk = makeInvocationRequest({ capability_id: 'cap_echo', payload: { msg: 'hi' } });
  const send1 = await sendRemoteInvocation({
    transport: executeTransport,
    peer: {
      peerUrl: unreachablePeerUrl,
      relayAvailable: true,
      relayUrl,
      nodeId,
      relayTo: to,
      timeoutMs: 150
    },
    invocation_request: invOk
  });
  console.log(JSON.stringify({ ok: true, role: 'machineA', test: 'success', invocation_id: invOk.invocation_id, transport_used: send1.transport_used }));

  // 2) Unknown handler fail-closed
  const invMissing = makeInvocationRequest({ capability_id: 'cap_missing', payload: { msg: 'x' } });
  const send2 = await sendRemoteInvocation({
    transport: executeTransport,
    peer: {
      peerUrl: unreachablePeerUrl,
      relayAvailable: true,
      relayUrl,
      nodeId,
      relayTo: to,
      timeoutMs: 150
    },
    invocation_request: invMissing
  });
  console.log(JSON.stringify({ ok: true, role: 'machineA', test: 'unknown_handler', invocation_id: invMissing.invocation_id, transport_used: send2.transport_used }));

  // 3) Invalid kind fail-closed
  const send3 = await executeTransport({
    peerUrl: unreachablePeerUrl,
    payload: { kind: 'WRONG_KIND', invocation_request: invOk },
    relayAvailable: true,
    timeoutMs: 150,
    relayUrl,
    nodeId,
    relayTo: to
  });
  console.log(JSON.stringify({ ok: true, role: 'machineA', test: 'invalid_kind', transport_used: send3.transport }));

  // 4) Friendship gate fail-closed
  const invGate = makeInvocationRequest({ friendship_id: 'fr_other', capability_id: 'cap_echo', payload: { msg: 'gate' } });
  const send4 = await sendRemoteInvocation({
    transport: executeTransport,
    peer: {
      peerUrl: unreachablePeerUrl,
      relayAvailable: true,
      relayUrl,
      nodeId,
      relayTo: to,
      timeoutMs: 150
    },
    invocation_request: invGate
  });
  console.log(JSON.stringify({ ok: true, role: 'machineA', test: 'friendship_gate', invocation_id: invGate.invocation_id, transport_used: send4.transport_used }));
}

async function main() {
  const args = parseArgs(process.argv);
  const role = args._[0];

  if (role === 'relay') return runRelay({ host: args.host, port: args.port });
  if (role === 'b') return runMachineB({ relayUrl: args.relayUrl, nodeId: args.nodeId, to: args.to });
  if (role === 'a') return runMachineA({ relayUrl: args.relayUrl, nodeId: args.nodeId, to: args.to });

  throw new Error('usage: relay|a|b');
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message, code: e.code || null }));
  process.exit(1);
});
