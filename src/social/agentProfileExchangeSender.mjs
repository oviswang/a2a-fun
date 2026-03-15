import crypto from 'node:crypto';

import { createRelayClient } from '../runtime/transport/relayClient.mjs';
import { createAgentProfileExchangeMessage } from './agentProfileExchangeMessage.mjs';

function nowIso() {
  return new Date().toISOString();
}

function fail(code) {
  return { ok: false, sent: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export async function sendAgentProfileExchange({ local_profile, remote_agent_id, relayUrl, dialogue_id = null, turn = 1, prompt = '' } = {}) {
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

  const client = createRelayClient({
    relayUrl,
    nodeId: String(local_profile.agent_id).trim(),
    registrationMode: 'v2',
    sessionId: `sess:${String(local_profile.agent_id).trim()}`,
    onForward: () => {}
  });

  try {
    await client.connect();
    await client.relay({ to: remote_agent_id.trim(), payload: msgOut.message });
    console.log(JSON.stringify({ ok: true, event: 'AGENT_PROFILE_EXCHANGE_SENT', from_agent_id: msgOut.message.from_agent_id, to_agent_id: msgOut.message.to_agent_id, dialogue_id: did, turn, ts: msgOut.message.timestamp }));
    return { ok: true, sent: true, message: msgOut.message, error: null };
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
