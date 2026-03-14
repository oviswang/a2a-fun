#!/usr/bin/env node
/**
 * Minimal two-machine relay E2E harness for Friendship Trigger Layer runtime wiring.
 *
 * Validates runtime path (via relay):
 * Machine A -> executeTransport(relay) -> relayServer -> Machine B relayInbound -> formalInboundEntry
 * -> protocolProcessor -> Phase3 hook -> friendship_candidate -> confirmations -> persistence -> friendship_record
 *
 * Hard constraints:
 * - does not modify transport/envelope/protocol/phase3 semantics
 * - no mailbox/capabilities/tasks/orchestration
 * - uses existing friendship primitives via formalInboundEntry runtime wiring
 *
 * Usage (run on separate machines):
 *   node scripts/friendship_two_machine_relay_e2e.mjs relay --host 0.0.0.0 --port 18881
 *   node scripts/friendship_two_machine_relay_e2e.mjs b --relayUrl ws://<relay-host>:18881/relay --nodeId nodeB
 *   node scripts/friendship_two_machine_relay_e2e.mjs a --relayUrl ws://<relay-host>:18881/relay --nodeId nodeA --to nodeB
 */

import { createRelayServer } from '../src/relay/relayServer.mjs';
import { createRelayClient } from '../src/runtime/transport/relayClient.mjs';
import { executeTransport } from '../src/runtime/transport/executeTransport.mjs';
import { handleRelayInbound } from '../src/runtime/inbound/relayInbound.mjs';
import { formalInboundEntry } from '../src/runtime/inbound/formalInboundEntry.mjs';

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

function makeValidEnvelope(session_id = 's1', msg_id = 'm1') {
  return {
    v: '0.4.3',
    type: 'human.entry',
    msg_id,
    session_id,
    ts: '2026-03-13T00:00:00Z',
    from: { actor_id: 'h:sha256:a', key_fpr: 'k1' },
    to: { actor_id: 'h:sha256:b', key_fpr: 'k2' },
    crypto: { enc: 'aead', kdf: 'x', nonce: 'AA==' },
    body: { ciphertext: Buffer.from('{"x":1}', 'utf8').toString('base64'), content_type: 'application/json' },
    sig: 'sig'
  };
}

async function runRelay({ host = '127.0.0.1', port = 18881 } = {}) {
  const srv = createRelayServer({ bindHost: host, port: Number(port), wsPath: '/relay' });
  await srv.start();
  const addr = srv.address();
  const url = `ws://${addr.address}:${addr.port}/relay`;
  console.log(JSON.stringify({ ok: true, role: 'relay', relayUrl: url }));
}

async function runMachineB({ relayUrl, nodeId = 'nodeB' } = {}) {
  if (!relayUrl) throw new Error('--relayUrl required');

  let processorCalls = 0;

  const protocolProcessor = {
    async processInbound({ envelope }) {
      processorCalls++;

      // Minimal: for msg_id m-friendship, force Phase3 to reach PROBING in one inbound.
      if (envelope.msg_id === 'm-friendship' || envelope.msg_id === 'm-failclosed') {
        return {
          session_apply_result: { next_state: { state: 'DISCONNECTED' } },
          audit_records: [],
          phase3_session_state: {
            session_id: envelope.session_id,
            peer_actor_id: envelope.from.actor_id,
            state: 'LOCAL_ENTERED',
            local_entered: true,
            remote_entered: false
          },
          phase3_session_probe_message: {
            kind: 'SESSION_PROBE_ACK',
            session_id: envelope.session_id,
            peer_actor_id: envelope.from.actor_id
          }
        };
      }

      throw new Error('unexpected msg_id');
    }
  };

  const storage = { async readSession() { return null; } };

  const client = createRelayClient({
    relayUrl,
    nodeId,
    onForward: async (msg) => {
      await handleRelayInbound(msg, {
        onInbound: async (payload) => {
          const out = await formalInboundEntry(payload, { storage, protocolProcessor });
          console.log(
            JSON.stringify({
              ok: true,
              role: 'machineB',
              from: msg.from,
              processorCalls,
              inbound_ok: out.ok,
              inbound_error: out.error,
              phase3: out.response?.phase3 ?? null,
              friendship_candidate: out.response?.friendship_candidate ?? null,
              friendship_record: out.response?.friendship_record ?? null
            })
          );
          return out;
        }
      });
    }
  });

  await client.connect();
  console.log(JSON.stringify({ ok: true, role: 'machineB', nodeId, connected: true }));
}

async function runMachineA({ relayUrl, nodeId = 'nodeA', to = 'nodeB' } = {}) {
  if (!relayUrl) throw new Error('--relayUrl required');

  // Force relay path by using an unreachable direct peerUrl.
  const unreachablePeerUrl = 'http://127.0.0.1:9/';

  const send = async ({ msg_id, friendship_confirm_local, friendship_confirm_remote }) => {
    const payload = {
      envelope: makeValidEnvelope('s1', msg_id),
      friendship_confirm_local,
      friendship_confirm_remote
    };

    const out = await executeTransport({
      peerUrl: unreachablePeerUrl,
      payload,
      relayAvailable: true,
      timeoutMs: 150,
      relayUrl,
      nodeId,
      relayTo: to
    });

    console.log(
      JSON.stringify({
        ok: true,
        role: 'machineA',
        msg_id,
        transport: out.transport,
        relayTo: to
      })
    );
  };

  // Happy path: local + remote confirmations requested.
  await send({ msg_id: 'm-friendship', friendship_confirm_local: true, friendship_confirm_remote: true });

  // Fail-closed: remote confirmation without local.
  await send({ msg_id: 'm-failclosed', friendship_confirm_local: false, friendship_confirm_remote: true });
}

async function main() {
  const args = parseArgs(process.argv);
  const role = args._[0];

  if (role === 'relay') return runRelay({ host: args.host, port: args.port });
  if (role === 'b') return runMachineB({ relayUrl: args.relayUrl, nodeId: args.nodeId });
  if (role === 'a') return runMachineA({ relayUrl: args.relayUrl, nodeId: args.nodeId, to: args.to });

  throw new Error('usage: relay|a|b');
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message, code: e.code || null }));
  process.exit(1);
});
