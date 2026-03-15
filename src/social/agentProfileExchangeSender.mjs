import crypto from 'node:crypto';

import { createRelayClient } from '../runtime/transport/relayClient.mjs';
import { createAgentProfileExchangeMessage, isAgentProfileExchangeMessage } from './agentProfileExchangeMessage.mjs';
import { saveAgentProfileExchangeTranscript } from './agentProfileExchangeTranscript.mjs';
import { markAgentEngaged } from '../memory/localAgentMemory.mjs';
import { buildInterestPromptMessage } from './agentInterestPrompt.mjs';
import { registerPendingInterestPrompt } from './agentInterestDecisionHandler.mjs';
import { resolveActiveGateway } from './gatewayResolver.mjs';
import { deliverSocialFeedMessage } from './socialFeedDelivery.mjs';

function nowIso() {
  return new Date().toISOString();
}

function fail(code) {
  return { ok: false, sent: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export async function sendAgentProfileExchange({ local_profile, remote_agent_id, relayUrl, dialogue_id = null, turn = 1, prompt = '', workspace_path = null, replyTimeoutMs = 1500 } = {}) {
  if (!local_profile || typeof local_profile !== 'object') return fail('INVALID_LOCAL_PROFILE');
  if (typeof remote_agent_id !== 'string' || !remote_agent_id.trim()) return fail('INVALID_REMOTE_AGENT_ID');

  const did = dialogue_id || `pex:${crypto.randomUUID()}`;

  const msgOut = createAgentProfileExchangeMessage({
    dialogue_id: did,
    turn,
    from_agent_id: local_profile.agent_id,
    to_agent_id: remote_agent_id,
    name: local_profile.name,
    mission: local_profile.mission,
    summary: local_profile.summary,
    skills: Array.isArray(local_profile.skills) ? local_profile.skills : [],
    current_focus: local_profile.current_focus,
    prompt,
    message: buildProfileExchangeText({ profile: local_profile, prompt }),
    timestamp: nowIso()
  });

  if (!msgOut.ok) return fail(msgOut.error?.code || 'PROFILE_EXCHANGE_BUILD_FAILED');

  const fromId = String(local_profile.agent_id).trim();
  const toId = remote_agent_id.trim();

  let resolveReply;
  const replyPromise = new Promise((resolve) => {
    resolveReply = resolve;
  });

  const client = createRelayClient({
    relayUrl,
    nodeId: fromId,
    registrationMode: 'v2',
    sessionId: `sess:${fromId}`,
    onForward: ({ from, payload }) => {
      // Wait for exactly one turn-2 reply for this dialogue_id.
      if (!isAgentProfileExchangeMessage(payload)) return;
      if (payload.dialogue_id !== did) return;
      if (payload.turn !== 2) return;
      if (String(payload.from_agent_id).trim() !== toId) return;
      if (String(payload.to_agent_id).trim() !== fromId) return;
      resolveReply({ from, payload });
    }
  });

  try {
    await client.connect();
    await client.relay({ to: toId, payload: msgOut.message });
    console.log(JSON.stringify({ ok: true, event: 'AGENT_PROFILE_EXCHANGE_SENT', from_agent_id: msgOut.message.from_agent_id, to_agent_id: msgOut.message.to_agent_id, dialogue_id: did, turn, ts: msgOut.message.timestamp }));

    console.log(JSON.stringify({ ok: true, event: 'AGENT_PROFILE_EXCHANGE_WAITING_REPLY', dialogue_id: did, timeout_ms: replyTimeoutMs }));

    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), Math.max(100, replyTimeoutMs)));
    const got = await Promise.race([replyPromise, timeout]);

    if (!got) {
      console.log(JSON.stringify({ ok: true, event: 'AGENT_PROFILE_EXCHANGE_REPLY_TIMEOUT', dialogue_id: did }));
      return { ok: true, sent: true, message: msgOut.message, reply_received: false, reply: null, error: null };
    }

    console.log(JSON.stringify({ ok: true, event: 'AGENT_PROFILE_EXCHANGE_REPLY_RECEIVED', dialogue_id: did, from: got.from }));

    // Best-effort: save transcript on sender side when reply arrives.
    try {
      const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path.trim() : (process.env.A2A_WORKSPACE_PATH || process.cwd());
      await saveAgentProfileExchangeTranscript({
        workspace_path: ws,
        dialogue_id: did,
        topic: 'introduced→engaged profile exchange',
        agentA: { agent_id: fromId, name: msgOut.message.name || '' },
        agentB: { agent_id: toId, name: got.payload.name || '' },
        turns: [msgOut.message, got.payload],
        summary: 'reply_received'
      });

      await markAgentEngaged({ workspace_path: ws, peer_agent_id: toId, last_summary: String(got.payload.message || '') });

      const ip = buildInterestPromptMessage({ peer_agent_id: toId, peer_name: got.payload.name || '', last_summary: String(got.payload.message || '') });
      if (ip.ok) {
        registerPendingInterestPrompt({ peer_agent_id: toId, last_summary: String(got.payload.message || '') });

        // Send through the same active gateway abstraction as social feed (best-effort).
        const ctx = globalThis.__A2A_SOCIAL_CONTEXT || null;
        const sendFn = globalThis.__A2A_SOCIAL_SEND || null;
        const gw = resolveActiveGateway({ context: ctx || {} });
        if (gw.ok && typeof sendFn === 'function') {
          await deliverSocialFeedMessage({ gateway: gw.gateway, channel_id: gw.channel_id, message: ip.prompt.text, send: sendFn });
          console.log(JSON.stringify({ ok: true, event: 'AGENT_INTEREST_PROMPT_SENT', peer_agent_id: toId, gateway: gw.gateway, channel_id: gw.channel_id }));
        }
      }
    } catch {
      // ignore
    }

    return { ok: true, sent: true, message: msgOut.message, reply_received: true, reply: got.payload, error: null };
  } catch (e) {
    return { ok: false, sent: false, error: { code: e?.code || 'PROFILE_EXCHANGE_SEND_FAILED' } };
  } finally {
    await client.close().catch(() => {});
  }
}

function buildProfileExchangeText({ profile, prompt }) {
  const p = profile || {};
  const name = String(p.name || p.agent_id || '').trim();
  const focus = String(p.current_focus || '').trim();
  const skills = Array.isArray(p.skills) ? p.skills.slice(0, 5) : [];

  const parts = [];
  parts.push(`${name} profile exchange.`);
  if (focus) parts.push(`Current focus: ${focus}.`);
  if (skills.length) parts.push(`Strengths: ${skills.join(', ')}.`);
  if (prompt) parts.push(`Prompt: ${String(prompt).trim()}`);
  return parts.join(' ').slice(0, 1200);
}
