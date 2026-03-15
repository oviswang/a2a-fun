import { getAgentRecentActivity } from './agentRecentActivity.mjs';
import { createAgentActivityDialogueMessage, isAgentActivityDialogueMessage } from './agentActivityDialogueMessage.mjs';
import { createRelayClient } from '../runtime/transport/relayClient.mjs';

function nowIso() {
  return new Date().toISOString();
}

function safe(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function fmtFacts(ra) {
  if (!ra || typeof ra !== 'object') return '(no recent activity available)';
  const parts = [];
  if (typeof ra.hostname === 'string' && ra.hostname) parts.push(`hostname=${ra.hostname}`);
  if (typeof ra.visible_agents_count === 'number') parts.push(`visible_agents=${ra.visible_agents_count}`);
  if (Array.isArray(ra.capabilities) && ra.capabilities.length) parts.push(`caps=${ra.capabilities.slice(0, 6).join(',')}`);
  if (typeof ra.latest_peer === 'string' && ra.latest_peer) parts.push(`latest_peer=${ra.latest_peer}`);
  if (typeof ra.latest_relationship_state === 'string' && ra.latest_relationship_state) parts.push(`latest_state=${ra.latest_relationship_state}`);
  return parts.join(' | ') || '(no facts)';
}

// In-memory dialogue state (per-process)
const sessions = new Map(); // dialogue_id -> { last_turn }

export async function receiveAgentActivityDialogue({ workspace_path, payload, relayUrl, nodeId, from } = {}) {
  if (!isAgentActivityDialogueMessage(payload)) return { ok: false, error: { code: 'NOT_ACTIVITY_DIALOGUE' } };

  const did = safe(payload.dialogue_id);
  const turn = Number(payload.turn);
  const fromId = safe(payload.from_agent_id);
  const toId = safe(payload.to_agent_id);

  if (!did || !Number.isFinite(turn) || !fromId || !toId) return { ok: false, error: { code: 'BAD_PAYLOAD' } };

  const state = sessions.get(did) || { last_turn: 0 };
  if (turn <= state.last_turn) {
    return { ok: true, applied: false, reason: 'DUPLICATE_OR_OUT_OF_ORDER' };
  }

  state.last_turn = turn;
  sessions.set(did, state);

  console.log(JSON.stringify({ ok: true, event: 'AGENT_ACTIVITY_DIALOGUE_RECEIVED', dialogue_id: did, turn, from_agent_id: fromId, to_agent_id: toId, ts: nowIso() }));

  const local = await getAgentRecentActivity({ workspace_path });

  const ru = typeof relayUrl === 'string' && relayUrl.trim() ? relayUrl.trim() : null;
  const nid = safe(nodeId) || toId;
  const replyTo = safe(from) || fromId;

  async function reply(payloadToSend) {
    if (!ru) throw new Error('MISSING_RELAY_URL');
    const client = await createRelayClient({ relayUrl: ru, nodeId: nid, registrationMode: 'v2', sessionId: `sess:${nid}`, onForward: () => {} });
    try {
      await client.connect();
      await client.relay({ to: replyTo, payload: payloadToSend });
      console.log(JSON.stringify({ ok: true, event: 'AGENT_ACTIVITY_DIALOGUE_REPLIED', dialogue_id: did, to: replyTo, turn: payloadToSend?.turn, ts: nowIso() }));
    } catch (err) {
      console.log(JSON.stringify({ ok: false, event: 'AGENT_ACTIVITY_DIALOGUE_REPLY_FAILED', dialogue_id: did, to: replyTo, error: String(err?.message || err), ts: nowIso() }));
      throw err;
    } finally {
      await client.close().catch(() => {});
    }
  }

  // Turn 1 => reply with Turn 2
  if (turn === 1) {
    const bFacts = fmtFacts(local);
    const msgText = [
      `Recent local activity (me): ${bFacts}`,
      `One difference vs you: my visible_agents=${local.visible_agents_count ?? 'n/a'}, your visible_agents=${payload.recent_activity?.visible_agents_count ?? 'n/a'}.`,
      `Next step (me): ${local.next_step || 'n/a'}`
    ].join('\n');

    const out = createAgentActivityDialogueMessage({
      dialogue_id: did,
      turn: 2,
      from_agent_id: toId,
      to_agent_id: fromId,
      hostname: local.hostname,
      recent_activity: local,
      message: msgText,
      timestamp: nowIso()
    });

    if (!out.ok) return { ok: false, error: out.error };

    await reply(out.message);
    return { ok: true, applied: true, replied: true, reply_turn: 2 };
  }

  // Turn 3 => reply with Turn 4
  if (turn === 3) {
    const msgText = [
      `Answer: ${safe(payload.message).slice(0, 120) || '(no question parsed)'}`,
      `Common ground: local_memory_count=${local.recent_events?.find?.((e) => e.kind === 'local_memory')?.count ?? 'n/a'}.`,
      `Difference: hostnames differ (me=${local.hostname}, you=${payload.hostname}).`
    ].join('\n');

    const out = createAgentActivityDialogueMessage({
      dialogue_id: did,
      turn: 4,
      from_agent_id: toId,
      to_agent_id: fromId,
      hostname: local.hostname,
      recent_activity: local,
      message: msgText,
      timestamp: nowIso()
    });

    if (!out.ok) return { ok: false, error: out.error };
    await reply(out.message);
    return { ok: true, applied: true, replied: true, reply_turn: 4 };
  }

  return { ok: true, applied: true, replied: false };
}
