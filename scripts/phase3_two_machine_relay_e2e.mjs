#!/usr/bin/env node
/**
 * Minimal two-machine relay E2E harness for Phase 3 (Session / Probe Runtime).
 *
 * Hard constraints:
 * - does not modify transport semantics (uses existing relayClient/relayServer/relayInbound)
 * - does not modify Phase 2 envelope semantics (uses formalInboundEntry validation)
 * - no mailbox, no capability invocation, no friendship persistence
 * - scope limited to SESSION_PROBE_INIT / SESSION_PROBE_ACK validation
 *
 * Usage (run on separate machines):
 *   node scripts/phase3_two_machine_relay_e2e.mjs relay --host 0.0.0.0 --port 18880
 *   node scripts/phase3_two_machine_relay_e2e.mjs b --relayUrl ws://<relay-host>:18880/relay
 *   node scripts/phase3_two_machine_relay_e2e.mjs a --relayUrl ws://<relay-host>:18880/relay --to nodeB
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

async function runRelay({ host = '127.0.0.1', port = 18880 } = {}) {
  const srv = createRelayServer({ bindHost: host, port: Number(port), wsPath: '/relay' });
  await srv.start();
  const addr = srv.address();
  const url = `ws://${addr.address}:${addr.port}/relay`;
  console.log(JSON.stringify({ ok: true, role: 'relay', relayUrl: url }));
}

async function runMachineB({ relayUrl, nodeId = 'nodeB' } = {}) {
  if (!relayUrl) throw new Error('--relayUrl required');

  let phase3State = null;
  let processorCalls = 0;

  const protocolProcessor = {
    async processInbound({ envelope }) {
      processorCalls++;

      if (envelope.msg_id === 'm-init') {
        return {
          session_apply_result: { next_state: { state: 'DISCONNECTED' } },
          audit_records: [],
          phase3_session_probe_message: {
            kind: 'SESSION_PROBE_INIT',
            session_id: envelope.session_id,
            peer_actor_id: 'h:sha256:peer'
          }
        };
      }

      if (envelope.msg_id === 'm-ack') {
        return {
          session_apply_result: { next_state: { state: 'DISCONNECTED' } },
          audit_records: [],
          phase3_session_state: phase3State,
          phase3_session_probe_message: {
            kind: 'SESSION_PROBE_ACK',
            session_id: envelope.session_id,
            peer_actor_id: 'h:sha256:peer'
          }
        };
      }

      if (envelope.msg_id === 'm-bad') {
        return {
          session_apply_result: { next_state: { state: 'DISCONNECTED' } },
          audit_records: [],
          phase3_session_probe_message: {
            kind: 'NOPE',
            session_id: envelope.session_id,
            peer_actor_id: 'h:sha256:peer'
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
      // msg is { from, payload }
      await handleRelayInbound(msg, {
        onInbound: async (payload) => {
          const out = await formalInboundEntry(payload, { storage, protocolProcessor });
          if (out.ok && out.response && out.response.phase3) phase3State = out.response.phase3;
          console.log(
            JSON.stringify({
              ok: true,
              role: 'machineB',
              from: msg.from,
              processorCalls,
              phase3: out.response?.phase3 ?? null,
              inbound_ok: out.ok,
              inbound_error: out.error
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

  const send = async (msg_id) => {
    const payload = { envelope: makeValidEnvelope('s1', msg_id) };
    const out = await executeTransport({
      peerUrl: unreachablePeerUrl,
      payload,
      relayAvailable: true,
      timeoutMs: 150,
      relayUrl,
      nodeId,
      relayTo: to
    });
    console.log(JSON.stringify({ ok: true, role: 'machineA', msg_id, transport: out.transport }));
  };

  await send('m-init');
  await send('m-ack');
  await send('m-bad');
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
