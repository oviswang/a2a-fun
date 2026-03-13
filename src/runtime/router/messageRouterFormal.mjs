import { buildFormalOutboundEnvelope } from '../../phase7/egress/formalOutboundBuilder.mjs';

export function createMessageRouterFormal({
  protocolProcessor,
  probeEngine,
  friendshipTrigger,
  friendshipWriter,
  storage,
  transport,
  auditBinder,
  runtimeOptions = {},
  formalOutboundBuilder = { buildFormalOutboundEnvelope }
}) {
  if (!protocolProcessor) throw new Error('messageRouterFormal: missing protocolProcessor');
  if (typeof protocolProcessor.processInbound !== 'function') throw new Error('messageRouterFormal: missing protocolProcessor.processInbound');
  if (!storage) throw new Error('messageRouterFormal: missing storage');
  if (typeof storage.readSession !== 'function' || typeof storage.writeSession !== 'function') {
    throw new Error('messageRouterFormal: storage must implement readSession/writeSession');
  }

  async function handleRemoteEnvelope({ envelope }) {
    if (!envelope || typeof envelope !== 'object') throw new Error('messageRouterFormal: missing envelope');
    if (!envelope.session_id) throw new Error('messageRouterFormal: missing envelope.session_id');

    const session_id = envelope.session_id;
    const state = (await storage.readSession(session_id)) ?? {
      session_id,
      peer_actor_id: envelope.peer_actor_id ?? 'h:sha256:unknown',
      state: 'DISCONNECTED',
      local_entered: false,
      remote_entered: false
    };

    const processor_result = await protocolProcessor.processInbound({ envelope, state });

    if (processor_result?.session_apply_result?.next_state) {
      await storage.writeSession(session_id, processor_result.session_apply_result.next_state);
    }

    let next_probe_message = null;
    if (probeEngine && typeof probeEngine.next === 'function' && processor_result?.session_apply_result?.next_state) {
      next_probe_message = probeEngine.next({ state: processor_result.session_apply_result.next_state, transcript: [] });
    }

    // Optional friendship trigger (off by default)
    let trigger_result = null;
    if (
      runtimeOptions.enableFriendshipTrigger === true &&
      friendshipTrigger &&
      typeof friendshipTrigger.triggerFriendshipWriteIfNeeded === 'function'
    ) {
      trigger_result = await friendshipTrigger.triggerFriendshipWriteIfNeeded({
        session_apply_result: processor_result.session_apply_result,
        peer_actor_id: state.peer_actor_id,
        peer_key_fpr: state.peer_key_fpr ?? null,
        session_id,
        storage,
        auditBinder,
        friendshipWriter
      });
    }

    // Egress:
    // - TEST_STUB_OUTBOUND is preserved as-is (test-only, localhost-only, disabled by default)
    // - FORMAL outbound is a separate optional path and is disabled by default

    let outbound_sent = null;
    let formal_outbound = null;

    if (next_probe_message && transport && typeof transport.send === 'function') {
      // Formal outbound path (preferred when explicitly enabled)
      // Safety boundary: formalOutboundUrl MUST be an explicitly configured trusted peer endpoint.
      // - No dynamic discovery.
      // - Must NOT be derived from inbound messages.
      if (runtimeOptions.enableFormalOutbound === true) {
        const url = runtimeOptions.formalOutboundUrl;
        if (!url) throw new Error('messageRouterFormal: enableFormalOutbound requires formalOutboundUrl');

        const built = await formalOutboundBuilder.buildFormalOutboundEnvelope({
          session_id,
          msg_id: `m_${Date.now()}`,
          ts: new Date().toISOString(),
          from_actor_id: runtimeOptions.from_actor_id,
          to_actor_id: state.peer_actor_id,
          from_key_fpr: runtimeOptions.from_key_fpr,
          to_key_fpr: runtimeOptions.to_key_fpr,
          type: next_probe_message.type,
          body: next_probe_message.body,
          encrypt: runtimeOptions.encrypt,
          sign: runtimeOptions.sign
        });

        formal_outbound = built;
        outbound_sent = await transport.send({ url, envelope: built.envelope });
      } else if (runtimeOptions.allowTestStubOutbound === true) {
        // Test stub path (unchanged)
        const peerUrl = envelope.reply_to_url;
        if (peerUrl && isLocalhostUrl(peerUrl)) {
          const outEnv = {
            stub: true,
            stub_kind: 'TEST_STUB_OUTBOUND',
            session_id,
            msg_id: `m_${Date.now()}`,
            ts: new Date().toISOString(),
            type: next_probe_message.type,
            body: next_probe_message.body
          };
          outbound_sent = await transport.send({ url: peerUrl, envelope: outEnv });
        }
      }
    }

    return { processor_result, next_probe_message, trigger_result, formal_outbound, outbound_sent };
  }

  return { handleRemoteEnvelope };
}

function isLocalhostUrl(u) {
  try {
    const url = new URL(u);
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  } catch {
    return false;
  }
}
