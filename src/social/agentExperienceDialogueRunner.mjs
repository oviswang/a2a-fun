import crypto from 'node:crypto';

import { createRelayClient } from '../runtime/transport/relayClient.mjs';
import { createAgentExperienceDialogueMessage } from './agentExperienceDialogueMessage.mjs';
import { getAgentRecentActivity } from './agentRecentActivity.mjs';
import { saveExperienceDialogueTranscript } from './agentExperienceDialogueTranscript.mjs';

function nowIso() {
  return new Date().toISOString();
}

function safe(s) {
  return String(s || '').trim();
}

async function fetchLocalFacts({ workspace_path } = {}) {
  const ra = await getAgentRecentActivity({ workspace_path });
  return {
    hostname: ra.hostname,
    openclaw_focus: ra.openclaw_current_focus || null,
    recent_task: Array.isArray(ra.openclaw_recent_tasks) && ra.openclaw_recent_tasks.length ? ra.openclaw_recent_tasks[0] : null,
    recent_activity: ra
  };
}

export async function runAgentExperienceDialogue({
  workspace_path,
  from_agent_id,
  to_agent_id,
  relayUrl = 'wss://bootstrap.a2a.fun/relay',
  topic = 'What problem is your human currently trying to solve?'
} = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  const fromId = safe(from_agent_id);
  const toId = safe(to_agent_id);
  if (!fromId || !toId) return { ok: false, error: { code: 'MISSING_AGENT_IDS' } };

  const dialogue_id = `exp:${crypto.randomUUID()}`;

  const inbox = [];
  const client = createRelayClient({
    relayUrl,
    nodeId: fromId,
    registrationMode: 'v2',
    sessionId: `sess:${fromId}:exp`,
    onForward: ({ from, payload }) => inbox.push({ from, payload })
  });
  await client.connect();

  const localA = await fetchLocalFacts({ workspace_path: ws });

  const waitTurn = async (turn, ms = 12000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const idx = inbox.findIndex((m) => m?.payload?.kind === 'AGENT_EXPERIENCE_DIALOGUE' && m.payload.dialogue_id === dialogue_id && m.payload.turn === turn);
      if (idx !== -1) return { ok: true, payload: inbox.splice(idx, 1)[0].payload };
      await new Promise((r) => setTimeout(r, 50));
    }
    return { ok: false, error: { code: 'TIMEOUT', expectedTurn: turn } };
  };

  const turns = [];

  // Turn 1 (A)
  const t1Text = [
    `OpenClaw focus (me): ${safe(localA.openclaw_focus || 'n/a')}.`,
    `One real recent task (me): ${safe(localA.recent_task || 'n/a')}.`,
    `Question: what problem is your human currently trying to solve? Please include one concrete local activity.`
  ].join('\n');

  const t1 = createAgentExperienceDialogueMessage({
    dialogue_id,
    turn: 1,
    from_agent_id: fromId,
    to_agent_id: toId,
    hostname: localA.hostname,
    message: t1Text,
    created_at: nowIso()
  });
  if (!t1.ok) return { ok: false, error: t1.error };
  await client.relay({ to: toId, payload: t1.message });
  turns.push({ turn: 1, ts: t1.message.created_at, direction: 'A->B', from_agent_id: fromId, from_hostname: localA.hostname, message: t1Text });

  // Turn 2 (B)
  const t2r = await waitTurn(2);
  if (!t2r.ok) return { ok: false, error: t2r.error };
  const b2 = t2r.payload;
  turns.push({ turn: 2, ts: b2.created_at, direction: 'B->A', from_agent_id: b2.from_agent_id, from_hostname: b2.hostname, message: b2.message });

  // Turn 3 (A)
  const t3Text = [
    `Got it — you mentioned: ${safe(b2.message).slice(0, 120)}`,
    `Practical question: how did you implement that recent task end-to-end (what steps, what checks)?`
  ].join('\n');
  const t3 = createAgentExperienceDialogueMessage({
    dialogue_id,
    turn: 3,
    from_agent_id: fromId,
    to_agent_id: toId,
    hostname: localA.hostname,
    message: t3Text,
    created_at: nowIso()
  });
  await client.relay({ to: toId, payload: t3.message });
  turns.push({ turn: 3, ts: t3.message.created_at, direction: 'A->B', from_agent_id: fromId, from_hostname: localA.hostname, message: t3Text });

  // Turn 4 (B)
  const t4r = await waitTurn(4);
  if (!t4r.ok) return { ok: false, error: t4r.error };
  const b4 = t4r.payload;
  turns.push({ turn: 4, ts: b4.created_at, direction: 'B->A', from_agent_id: b4.from_agent_id, from_hostname: b4.hostname, message: b4.message });

  // Turn 5 (A)
  const t5Text = [
    `Thanks — I’m noting your workflow: ${safe(b4.message).slice(0, 140)}`,
    `Difficulty (me): keeping relay sessions stable during back-and-forth (avoid duplicate sessions / unregister).`,
    `Practical question: what guardrail would you add first to prevent regression?`
  ].join('\n');
  const t5 = createAgentExperienceDialogueMessage({
    dialogue_id,
    turn: 5,
    from_agent_id: fromId,
    to_agent_id: toId,
    hostname: localA.hostname,
    message: t5Text,
    created_at: nowIso()
  });
  await client.relay({ to: toId, payload: t5.message });
  turns.push({ turn: 5, ts: t5.message.created_at, direction: 'A->B', from_agent_id: fromId, from_hostname: localA.hostname, message: t5Text });

  // Turn 6 (B)
  const t6r = await waitTurn(6);
  if (!t6r.ok) return { ok: false, error: t6r.error };
  const b6 = t6r.payload;
  turns.push({ turn: 6, ts: b6.created_at, direction: 'B->A', from_agent_id: b6.from_agent_id, from_hostname: b6.hostname, message: b6.message });

  const saveOut = await saveExperienceDialogueTranscript({
    workspace_path: ws,
    dialogue_id,
    topic,
    relayUrl,
    node_a: { agent_id: fromId, hostname: localA.hostname },
    node_b: { agent_id: toId, hostname: b2.hostname },
    turns
  });

  await client.close();

  return { ok: true, dialogue_id, transcript_json: saveOut.transcript_json, transcript_md: saveOut.transcript_md };
}
