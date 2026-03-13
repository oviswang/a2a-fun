export function createMessageRouter({
  protocolProcessor,
  probeEngine,
  friendshipTrigger,
  friendshipWriter,
  storage,
  transport,
  auditBinder,
  runtimeOptions = {}
}) {
  if (!protocolProcessor) throw new Error('messageRouter: missing protocolProcessor');
  if (typeof protocolProcessor.processInbound !== 'function') throw new Error('messageRouter: missing protocolProcessor.processInbound');
  if (!storage) throw new Error('messageRouter: missing storage');
  if (typeof storage.readSession !== 'function' || typeof storage.writeSession !== 'function') {
    throw new Error('messageRouter: storage must implement readSession/writeSession');
  }

  async function handleRemoteEnvelope({ envelope }) {
    if (!envelope || typeof envelope !== 'object') throw new Error('messageRouter: missing envelope');
    if (!envelope.session_id) throw new Error('messageRouter: missing envelope.session_id');

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
      // Persistence semantics (minimal runtime): write the FULL next_state snapshot.
      // No patch-based persistence is implemented here.
      await storage.writeSession(session_id, processor_result.session_apply_result.next_state);
    }

    // ProbeEngine: optional suggestion step. No transcript persistence in minimal runtime.
    let next_probe_message = null;
    if (probeEngine && typeof probeEngine.next === 'function' && processor_result?.session_apply_result?.next_state) {
      next_probe_message = probeEngine.next({
        state: processor_result.session_apply_result.next_state,
        transcript: []
      });
    }

    // Friendship trigger/writer: optional side-effect layer.
    let trigger_result = null;
    // Friendship trigger is OPTIONAL and MUST be OFF by default.
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

    // Egress safety boundary:
    // - This runtime does NOT send a real Phase 2 protocol envelope outbound.
    // - Only a TEST_STUB outbound payload is supported, for minimal wiring/tests.
    // - Auto-send is OFF by default and must be explicitly enabled via runtimeOptions.
    // - reply_to_url is NOT trusted; in test mode it must be localhost.
    let outbound_sent = null;
    if (next_probe_message && transport && typeof transport.send === 'function') {
      const peerUrl = envelope.reply_to_url;
      if (runtimeOptions.allowTestStubOutbound === true && peerUrl && isLocalhostUrl(peerUrl)) {
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

    return {
      processor_result,
      next_probe_message,
      outbound_sent,
      trigger_result
    };
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
