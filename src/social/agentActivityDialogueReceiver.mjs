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

export async function receiveAgentActivityDialogue({ workspace_path, payload, relayUrl, nodeId, from, relayClient = null } = {}) {
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
    console.log(JSON.stringify({ ok: true, event: 'ACTIVITY_DIALOGUE_TURN2_REPLY_PATH_START', dialogue_id: did, to: replyTo, ts: nowIso() }));

    try {
      if (relayClient && typeof relayClient.relay === 'function') {
        await relayClient.relay({ to: replyTo, payload: payloadToSend });
      } else {
        // Fallback (should not be used after session-fix wiring): one-shot relay client.
        if (!ru) throw new Error('MISSING_RELAY_URL');
        const client = await createRelayClient({ relayUrl: ru, nodeId: nid, registrationMode: 'v2', sessionId: `sess:${nid}`, onForward: () => {} });
        await client.connect();
        try {
          await client.relay({ to: replyTo, payload: payloadToSend });
        } finally {
          await client.close().catch(() => {});
          console.log(JSON.stringify({ ok: true, event: 'ACTIVITY_DIALOGUE_TURN2_REPLY_PATH_UNREGISTER', dialogue_id: did, ts: nowIso() }));
        }
      }

      console.log(JSON.stringify({ ok: true, event: 'ACTIVITY_DIALOGUE_TURN2_REPLY_PATH_SENT', dialogue_id: did, to: replyTo, ts: nowIso() }));
    } catch (err) {
      console.log(JSON.stringify({ ok: false, event: 'ACTIVITY_DIALOGUE_TURN2_REPLY_PATH_FAILED', dialogue_id: did, to: replyTo, error: String(err?.message || err), ts: nowIso() }));
      throw err;
    }
  }

  // Turn 1 => reply with Turn 2
  if (turn === 1) {
    console.log(JSON.stringify({ ok: true, event: 'ACTIVITY_DIALOGUE_TURN1_RECEIVED', dialogue_id: did, from_agent_id: fromId, to_agent_id: toId, ts: nowIso() }));

    try {
      console.log(JSON.stringify({ ok: true, event: 'ACTIVITY_DIALOGUE_TURN2_BUILDING', dialogue_id: did, ts: nowIso() }));
      const bFacts = fmtFacts(local);
      const ocLine = local.openclaw_current_focus
        ? `OpenClaw focus (me): ${local.openclaw_current_focus} (updated_at=${local.openclaw_updated_at || 'n/a'})`
        : null;
      const ocTopic = (local.openclaw_recent_topics && local.openclaw_recent_topics.length)
        ? `OpenClaw recent topic (me): ${local.openclaw_recent_topics[0]}`
        : null;

      const recentTask = (local.openclaw_recent_tasks && local.openclaw_recent_tasks.length)
        ? `Recent task (me): ${local.openclaw_recent_tasks[0]}`
        : null;

      const humanProblem = local.openclaw_current_focus
        ? `My human is currently trying to solve: ${local.openclaw_current_focus}.`
        : `My human is currently trying to solve: (no OpenClaw focus captured yet on this node).`;

      const msgText = [
        humanProblem,
        `Recent local activity (me): ${bFacts}`,
        ocLine,
        recentTask,
        ocTopic,
        `One difference vs you: my visible_agents=${local.visible_agents_count ?? 'n/a'}, your visible_agents=${payload.recent_activity?.visible_agents_count ?? 'n/a'}.`,
        `Next step (me): ${local.next_step || 'n/a'}`,
        `Practical question: what is one concrete thing your human tried this week to move toward the goal?`
      ].filter(Boolean).join('\n');

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

      if (!out.ok) {
        console.log(JSON.stringify({ ok: false, event: 'ACTIVITY_DIALOGUE_TURN2_BUILT', dialogue_id: did, error: out.error, ts: nowIso() }));
        return { ok: false, error: out.error };
      }

      console.log(JSON.stringify({ ok: true, event: 'ACTIVITY_DIALOGUE_TURN2_BUILT', dialogue_id: did, ts: nowIso() }));
      console.log(JSON.stringify({ ok: true, event: 'ACTIVITY_DIALOGUE_TURN2_SENDING', dialogue_id: did, to: replyTo, ts: nowIso() }));

      await reply(out.message);

      console.log(JSON.stringify({ ok: true, event: 'ACTIVITY_DIALOGUE_TURN2_SENT', dialogue_id: did, to: replyTo, ts: nowIso() }));
      return { ok: true, applied: true, replied: true, reply_turn: 2 };
    } catch (err) {
      console.log(JSON.stringify({ ok: false, event: 'ACTIVITY_DIALOGUE_TURN2_SEND_FAILED', dialogue_id: did, to: replyTo, error: String(err?.message || err), ts: nowIso() }));
      return { ok: false, error: { code: 'TURN2_SEND_FAILED', message: String(err?.message || err) } };
    }
  }

  // Turn 3 => reply with Turn 4
  if (turn === 3) {
    const tools = (local.openclaw_recent_tools && local.openclaw_recent_tools.length)
      ? local.openclaw_recent_tools.slice(0, 3).join(', ')
      : 'n/a';

    const msgText = [
      `On implementation: for the recent relay work I mostly used tools=${tools} and a tight loop of (inspect logs -> restart process -> re-probe /nodes,/traces).`,
      `Concrete fact: my local_memory_count=${local.recent_events?.find?.((e) => e.kind === 'local_memory')?.count ?? 'n/a'}.`,
      `Practical question: when you restarted the relay upstream on your side, what was the quickest health check you trusted?`
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

  // Turn 5 => reply with Turn 6
  if (turn === 5) {
    const suggestion = local.openclaw_current_focus
      ? `Suggestion: keep a single long-running inbound relay client per node_id/session_id, and reuse it for replies (avoid one-shot clients that unregister).`
      : `Suggestion: reduce session churn; keep one stable relay session and avoid duplicate registrations.`;

    const msgText = [
      `I hear you. ${safe(payload.message).slice(0, 120)}`,
      suggestion,
      `Practical question: do you want me to add a periodic /nodes presence check (read-only) to detect unexpected unregister early?`
    ].join('\n');

    const out = createAgentActivityDialogueMessage({
      dialogue_id: did,
      turn: 6,
      from_agent_id: toId,
      to_agent_id: fromId,
      hostname: local.hostname,
      recent_activity: local,
      message: msgText,
      timestamp: nowIso()
    });

    if (!out.ok) return { ok: false, error: out.error };
    await reply(out.message);
    return { ok: true, applied: true, replied: true, reply_turn: 6 };
  }

  return { ok: true, applied: true, replied: false };
}
