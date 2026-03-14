#!/usr/bin/env node
/**
 * Minimal two-machine relay E2E harness for Conversation -> Friendship runtime integration.
 *
 * Target path:
 * Machine A (conversation pipeline -> conversation handoff -> phase3 probe-init message)
 * -> executeTransport(relay)
 * -> relayServer
 * -> Machine B relayInbound -> formalInboundEntry -> protocolProcessor -> Phase3 hook -> applySessionProbeMessage
 *
 * Usage (run on separate machines):
 *   node scripts/conversation_friendship_two_machine_relay_e2e.mjs relay --host 0.0.0.0 --port 18883
 *   node scripts/conversation_friendship_two_machine_relay_e2e.mjs b --relayUrl ws://<relay-host>:18883/relay --nodeId nodeB
 *   node scripts/conversation_friendship_two_machine_relay_e2e.mjs a --relayUrl ws://<relay-host>:18883/relay --nodeId nodeA --to nodeB
 */

import { createRelayServer } from '../src/relay/relayServer.mjs';
import { createRelayClient } from '../src/runtime/transport/relayClient.mjs';
import { executeTransport } from '../src/runtime/transport/executeTransport.mjs';
import { handleRelayInbound } from '../src/runtime/inbound/relayInbound.mjs';
import { formalInboundEntry } from '../src/runtime/inbound/formalInboundEntry.mjs';

import { createDiscoveryCandidate, DISCOVERY_SOURCES } from '../src/discovery/discoveryCandidate.mjs';
import { evaluateDiscoveryCompatibility } from '../src/discovery/discoveryCompatibility.mjs';
import { createDiscoveryConversationPreview } from '../src/discovery/discoveryConversationPreview.mjs';
import { createDiscoveryInteraction } from '../src/discovery/discoveryInteraction.mjs';

import { createConversationOpeningMessage } from '../src/conversation/conversationOpeningMessage.mjs';
import { createConversationTurn } from '../src/conversation/conversationTurn.mjs';
import { createConversationTranscript } from '../src/conversation/conversationTranscript.mjs';
import { createConversationSurface } from '../src/conversation/conversationSurface.mjs';
import { createConversationFriendshipHandoff } from '../src/conversation/conversationFriendshipHandoff.mjs';
import { startPhase3ProbeFromConversationHandoff } from '../src/runtime/conversation/conversationHandoffToPhase3.mjs';

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

function makeEnvelopeWithProbe(session_id, msg_id, probeMsg) {
  const bodyJson = JSON.stringify({ phase3_probe_message: probeMsg });
  return {
    v: '0.4.3',
    type: 'human.entry',
    msg_id,
    session_id,
    ts: '2026-03-13T00:00:00Z',
    from: { actor_id: 'h:sha256:a', key_fpr: 'k1' },
    to: { actor_id: 'h:sha256:b', key_fpr: 'k2' },
    crypto: { enc: 'aead', kdf: 'x', nonce: 'AA==' },
    body: { ciphertext: Buffer.from(bodyJson, 'utf8').toString('base64'), content_type: 'application/json' },
    sig: 'sig'
  };
}

async function runRelay({ host = '127.0.0.1', port = 18883 } = {}) {
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

      let decoded = null;
      try {
        decoded = JSON.parse(Buffer.from(envelope.body?.ciphertext ?? '', 'base64').toString('utf8'));
      } catch {
        decoded = null;
      }

      const probeMsg = decoded?.phase3_probe_message ?? null;
      if (!probeMsg) {
        return { session_apply_result: { next_state: { state: 'DISCONNECTED' } }, audit_records: [] };
      }

      return {
        session_apply_result: { next_state: { state: 'DISCONNECTED' } },
        audit_records: [],
        phase3_session_state: phase3State,
        phase3_session_probe_message: probeMsg
      };
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
          if (out.ok && out.response?.phase3) phase3State = out.response.phase3;

          console.log(
            JSON.stringify({
              ok: true,
              role: 'machineB',
              from: msg.from,
              processorCalls,
              inbound_ok: out.ok,
              inbound_error: out.error,
              phase3: out.response?.phase3 ?? null,
              friendship_candidate: out.response?.friendship_candidate ?? null
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

  const unreachablePeerUrl = 'http://127.0.0.1:9/';

  // Build minimal discovery interaction input.
  const dc = createDiscoveryCandidate({
    peer_actor_id: 'h:sha256:peer_remote',
    peer_url: 'https://example.com/a2a',
    source: DISCOVERY_SOURCES.KNOWN_PEERS
  });
  const comp = evaluateDiscoveryCompatibility({ candidate: dc });
  const prev = createDiscoveryConversationPreview({ candidate: dc, compatibility: comp });
  const interaction = createDiscoveryInteraction({ preview: prev });

  // Conversation pipeline.
  const opening = createConversationOpeningMessage({ interaction });
  const turn = createConversationTurn({ opening, speaker: 'AGENT' });
  const transcript = createConversationTranscript({ opening, turns: [turn] });
  const surface = createConversationSurface({ transcript });

  const handoff = createConversationFriendshipHandoff({ surface, action: 'HANDOFF_TO_FRIENDSHIP' });
  const started = startPhase3ProbeFromConversationHandoff({
    handoff,
    session_id: 'sess_cf_remote_1',
    peer_actor_id: 'h:sha256:peer_remote'
  });

  const env = makeEnvelopeWithProbe('sess_cf_remote_1', 'm-conversation-probe-init', started.response.phase3_probe_message);
  const payload = { envelope: env };

  const sendRes = await executeTransport({
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
      transport: sendRes.transport,
      opening_id: opening.opening_id,
      turn_id: turn.turn_id,
      transcript_id: transcript.transcript_id,
      surface_id: surface.surface_id,
      handoff_id: handoff.handoff_id,
      phase3_probe_kind: started.response.phase3_probe_message.kind
    })
  );

  // Invalid path: send unknown kind to prove fail-closed on Machine B.
  const badEnv = makeEnvelopeWithProbe('sess_cf_remote_bad', 'm-bad-kind', {
    kind: 'NOPE',
    session_id: 'sess_cf_remote_bad',
    peer_actor_id: 'h:sha256:peer_remote'
  });

  const badSendRes = await executeTransport({
    peerUrl: unreachablePeerUrl,
    payload: { envelope: badEnv },
    relayAvailable: true,
    timeoutMs: 150,
    relayUrl,
    nodeId,
    relayTo: to
  });

  console.log(JSON.stringify({ ok: true, role: 'machineA', msg: 'sent_bad_kind', transport: badSendRes.transport }));
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
