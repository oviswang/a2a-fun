import crypto from 'node:crypto';

import { createRelayClient } from '../runtime/transport/relayClient.mjs';
import { getAgentRecentActivity } from './agentRecentActivity.mjs';
import { createAgentActivityDialogueMessage } from './agentActivityDialogueMessage.mjs';
import { saveActivityDialogueTranscript } from './agentActivityDialogueTranscript.mjs';

function nowIso() {
  return new Date().toISOString();
}

function safe(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function newDialogueId() {
  return `act:${crypto.randomUUID()}`;
}

function describeLocal(ra, agent_id) {
  const facts = [];
  if (typeof ra.visible_agents_count === 'number') facts.push(`visible_agents=${ra.visible_agents_count}`);
  if (Array.isArray(ra.capabilities) && ra.capabilities.length) facts.push(`caps=${ra.capabilities.slice(0, 6).join(',')}`);
  if (typeof ra.latest_peer === 'string' && ra.latest_peer) facts.push(`latest_peer=${ra.latest_peer}`);
  if (typeof ra.latest_relationship_state === 'string' && ra.latest_relationship_state) facts.push(`latest_state=${ra.latest_relationship_state}`);
  const head = facts.join(' | ') || '(no facts)';
  return `${ra.hostname} (${agent_id}): ${head}`;
}

export async function runAgentActivityDialogue({
  workspace_path,
  relayUrl,
  from_agent_id,
  to_agent_id
} = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  const fromId = safe(from_agent_id);
  const toId = safe(to_agent_id);
  if (!fromId || !toId) return { ok: false, error: { code: 'MISSING_AGENT_IDS' } };

  const dialogue_id = newDialogueId();

  const localA = await getAgentRecentActivity({ workspace_path: ws });

  const turns = [];

  const inbox = [];
  const client = await createRelayClient({
    relayUrl,
    nodeId: fromId,
    registrationMode: 'v2',
    sessionId: `sess:${fromId}`,
    onForward: ({ from, payload }) => {
      inbox.push({ from, payload });
    }
  });
  await client.connect();

  const waitForTurn = async (expectedTurn, timeoutMs = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const idx = inbox.findIndex((m) => m?.payload?.kind === 'AGENT_ACTIVITY_DIALOGUE' && m.payload.dialogue_id === dialogue_id && Number(m.payload.turn) === expectedTurn);
      if (idx !== -1) {
        const msg = inbox.splice(idx, 1)[0];
        return { ok: true, payload: msg.payload };
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return { ok: false, error: { code: 'TIMEOUT', expectedTurn } };
  };

  try {
    // Turn 1 (A -> B)
    const ocLine = localA.openclaw_current_focus
      ? `OpenClaw focus (me): ${localA.openclaw_current_focus} (updated_at=${localA.openclaw_updated_at || 'n/a'})`
      : null;
    const ocTask = (localA.openclaw_recent_tasks && localA.openclaw_recent_tasks.length)
      ? `OpenClaw recent task (me): ${localA.openclaw_recent_tasks[0]}`
      : null;

    const turn1Text = [
      `My human is currently trying to solve: ${localA.openclaw_current_focus || 'a concrete focus is not yet captured on this node'}.`,
      `Real local activity (me): ${describeLocal(localA, fromId)}`,
      ocLine,
      ocTask,
      `Practical question: what problem is your human currently trying to solve on your node? please include one real local fact.`
    ].filter(Boolean).join('\n');

    const t1 = createAgentActivityDialogueMessage({
      dialogue_id,
      turn: 1,
      from_agent_id: fromId,
      to_agent_id: toId,
      hostname: localA.hostname,
      recent_activity: localA,
      message: turn1Text,
      timestamp: nowIso()
    });
    if (!t1.ok) return { ok: false, error: t1.error };

    await client.relay({ to: toId, payload: t1.message });
    turns.push({ turn: 1, ts: t1.message.timestamp, direction: 'A->B', from_agent_id: fromId, from_hostname: localA.hostname, message: turn1Text, recent_activity: localA });

    // Turn 2 (B -> A)
    const t2r = await waitForTurn(2, 8000);
    if (!t2r.ok) return { ok: false, error: t2r.error };
    const b = t2r.payload;
    turns.push({ turn: 2, ts: b.timestamp, direction: 'B->A', from_agent_id: b.from_agent_id, from_hostname: b.hostname, message: b.message, recent_activity: b.recent_activity });

    // Turn 3 (A -> B) reference a concrete diff
    const aAsk = [
      `Ack: I hear your human focus is: ${b.recent_activity?.openclaw_current_focus || 'n/a'}. Mine is: ${localA.openclaw_current_focus || 'n/a'}.`,
      `You mentioned a recent task like: ${(b.recent_activity?.openclaw_recent_tasks && b.recent_activity.openclaw_recent_tasks[0]) ? b.recent_activity.openclaw_recent_tasks[0] : 'n/a'}.`,
      `Practical question: how did you implement that task (what exact checks or steps did you run to confirm it worked)?`
    ].join('\n');

    const t3 = createAgentActivityDialogueMessage({
      dialogue_id,
      turn: 3,
      from_agent_id: fromId,
      to_agent_id: toId,
      hostname: localA.hostname,
      recent_activity: localA,
      message: aAsk,
      timestamp: nowIso()
    });

    await client.relay({ to: toId, payload: t3.message });
    turns.push({ turn: 3, ts: t3.message.timestamp, direction: 'A->B', from_agent_id: fromId, from_hostname: localA.hostname, message: aAsk, recent_activity: localA });

    // Turn 4 (B -> A)
    const t4r = await waitForTurn(4, 8000);
    if (!t4r.ok) return { ok: false, error: t4r.error };
    const b4 = t4r.payload;
    turns.push({ turn: 4, ts: b4.timestamp, direction: 'B->A', from_agent_id: b4.from_agent_id, from_hostname: b4.hostname, message: b4.message, recent_activity: b4.recent_activity });

    // Turn 5 (A -> B) share one difficulty
    const t5txt = [
      `Difficulty (me): keeping relay sessions stable while sending replies (avoid unregister/duplicate-session issues).`,
      `Practical question: after you reply, do you keep the same inbound relay session alive, or do you reconnect?`
    ].join('\n');

    const t5 = createAgentActivityDialogueMessage({
      dialogue_id,
      turn: 5,
      from_agent_id: fromId,
      to_agent_id: toId,
      hostname: localA.hostname,
      recent_activity: localA,
      message: t5txt,
      timestamp: nowIso()
    });
    await client.relay({ to: toId, payload: t5.message });
    turns.push({ turn: 5, ts: t5.message.timestamp, direction: 'A->B', from_agent_id: fromId, from_hostname: localA.hostname, message: t5txt, recent_activity: localA });

    // Turn 6 (B -> A)
    const t6r = await waitForTurn(6, 8000);
    if (!t6r.ok) return { ok: false, error: t6r.error };
    const b6 = t6r.payload;
    turns.push({ turn: 6, ts: b6.timestamp, direction: 'B->A', from_agent_id: b6.from_agent_id, from_hostname: b6.hostname, message: b6.message, recent_activity: b6.recent_activity });

    // Persist transcript (sender side)
    const saveOut = await saveActivityDialogueTranscript({
      workspace_path: ws,
      dialogue_id,
      node_a: { agent_id: fromId, hostname: localA.hostname, recent_activity: localA },
      node_b: { agent_id: toId, hostname: b.hostname, recent_activity: b.recent_activity },
      turns
    });

    const node_a_recent_events = localA.recent_events?.map((e) => e.kind).filter(Boolean) ?? [];
    const node_b_recent_events = b.recent_activity?.recent_events?.map?.((e) => e.kind).filter(Boolean) ?? [];

    const visible_difference = Boolean(localA.hostname && b.hostname && localA.hostname !== b.hostname) ||
      (typeof localA.visible_agents_count === 'number' && typeof b.recent_activity?.visible_agents_count === 'number' && localA.visible_agents_count !== b.recent_activity.visible_agents_count);

    const distributed = true;

    return {
      ok: true,
      distributed,
      node_a_hostname: localA.hostname,
      node_b_hostname: b.hostname,
      node_a_recent_events,
      node_b_recent_events,
      visible_difference,
      transcript_json: saveOut.ok ? saveOut.transcript_json : null,
      transcript_md: saveOut.ok ? saveOut.transcript_md : null,
      error: null
    };
  } finally {
    await client.close().catch(() => {});
  }
}
