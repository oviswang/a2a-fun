import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildAttentionSnapshot } from '../attention/buildAttentionSnapshot.mjs';
import { loadLocalAgentMemory, getDefaultLocalAgentMemoryPath } from '../memory/localAgentMemory.mjs';
import { selectRelevantPeer } from '../attention/selectRelevantPeer.mjs';
import { buildConversationGoal } from './buildConversationGoal.mjs';
import { explainConversationGoal } from './explainConversationGoal.mjs';

import { listPublishedAgentsRemote } from '../discovery/sharedAgentDirectoryClient.mjs';
import { resolveLivePeerId } from './resolveLivePeerId.mjs';
import { checkPeerRelayHealth } from './checkPeerRelayHealth.mjs';

import { createRelayClient } from '../runtime/transport/relayClient.mjs';
import { createAgentExperienceDialogueMessage } from './agentExperienceDialogueMessage.mjs';

function nowIso() {
  return new Date().toISOString();
}

export async function runGoalDrivenExperienceDialogue({
  workspace_path,
  from_agent_id,
  requested_peer_id,
  relayUrl = 'wss://bootstrap.a2a.fun/relay',
  base_url = 'https://bootstrap.a2a.fun',
  relay_local_http = 'http://127.0.0.1:18884'
} = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  const fromId = String(from_agent_id || '').trim();
  const reqPeer = String(requested_peer_id || '').trim();
  if (!fromId || !reqPeer) return { ok: false, error: { code: 'MISSING_AGENT_IDS' } };

  const snapOut = await buildAttentionSnapshot({ workspace_path: ws, agent_id: fromId });
  const file_path = getDefaultLocalAgentMemoryPath({ workspace_path: ws });
  const mem = await loadLocalAgentMemory({ file_path }).catch(() => ({ ok: false, records: [] }));
  const dir = await listPublishedAgentsRemote({ base_url });

  const res = await resolveLivePeerId({
    requested_peer_id: reqPeer,
    local_memory: mem.ok ? mem : { records: [] },
    directory_agents: dir.ok ? dir.agents : []
  });
  if (!res.ok) return { ok: false, error: { code: 'PEER_RESOLUTION_FAILED' }, peer_resolution: res };

  // Best-effort traces fetch (local relay) for deterministic health gating
  let traces = [];
  try {
    const r = await fetch(`${relay_local_http}/traces`);
    const j = await r.json();
    traces = Array.isArray(j?.traces) ? j.traces : [];
  } catch {
    traces = [];
  }

  const health = await checkPeerRelayHealth({ node_id: res.resolved_peer_id, relay_local_http, traces });

  // Gate rules
  if (health.relay_health === 'unknown' || health.relay_health === 'unhealthy') {
    console.log(JSON.stringify({ ok: true, event: 'PEER_RELAY_NOT_READY', node_id: res.resolved_peer_id, relay_health: health.relay_health }));
    return { ok: false, error: { code: 'PEER_RELAY_NOT_READY', relay_health: health.relay_health }, peer_resolution: res, peer_relay_health: health };
  }
  if (health.relay_health === 'degraded') {
    console.log(JSON.stringify({ ok: true, event: 'PEER_RELAY_HEALTH_DEGRADED_BUT_ALLOWED', node_id: res.resolved_peer_id }));
  }

  const sel = selectRelevantPeer({ snapshot: snapOut.snapshot, local_memory: mem.ok ? mem : { records: [] }, candidates: dir.ok ? dir.agents : [] });
  const goalOut = buildConversationGoal({ attention_snapshot: snapOut.snapshot, selected_peer: sel, memory_gaps: snapOut.snapshot.memory_gaps });
  const exp = explainConversationGoal({ attention_snapshot: snapOut.snapshot, selected_peer: sel, goal: goalOut.goal });
  if (goalOut.goal.intent !== 'experience_exchange') return { ok: false, error: { code: 'INTENT_NOT_EXPERIENCE_EXCHANGE' } };

  const dialogue_id = `gx:${crypto.randomUUID()}`;
  const inbox = [];
  const client = createRelayClient({
    relayUrl,
    nodeId: fromId,
    registrationMode: 'v2',
    sessionId: `sess:${fromId}:goalx`,
    onForward: ({ from, payload }) => inbox.push({ from, payload })
  });
  await client.connect();

  const waitTurn = async (turn, ms = 15000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const idx = inbox.findIndex((m) => m.payload?.kind === 'AGENT_EXPERIENCE_DIALOGUE' && m.payload.dialogue_id === dialogue_id && m.payload.turn === turn);
      if (idx !== -1) return inbox.splice(idx, 1)[0].payload;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  };

  const turns = [];
  const toId = res.resolved_peer_id;

  const t1Text = [
    `Conversation goal topic: ${goalOut.goal.topic}`,
    `Intent: ${goalOut.goal.intent}`,
    `Question: ${goalOut.goal.question}`,
    `Expected output: ${goalOut.goal.expected_output}`
  ].join('\n');

  const t1 = createAgentExperienceDialogueMessage({ dialogue_id, turn: 1, from_agent_id: fromId, to_agent_id: toId, hostname: fromId, message: t1Text, created_at: nowIso() });
  await client.relay({ to: toId, payload: t1.message });
  turns.push({ turn: 1, ts: t1.message.created_at, direction: 'A->B', from_agent_id: fromId, from_hostname: fromId, message: t1Text });

  const b2 = await waitTurn(2);
  if (!b2) return { ok: false, error: { code: 'TIMEOUT_TURN2' }, peer_resolution: res, peer_relay_health: health };
  turns.push({ turn: 2, ts: b2.created_at, direction: 'B->A', from_agent_id: b2.from_agent_id, from_hostname: b2.hostname, message: b2.message });

  const t3Text = [
    `Thanks. Follow-up for experience_exchange on "${goalOut.goal.topic}":`,
    `1) What failed / what you would avoid?`,
    `2) Exact tool/workflow used (commands/checks, high-level)?`,
    `3) What next step would you suggest on my side?`
  ].join('\n');
  const t3 = createAgentExperienceDialogueMessage({ dialogue_id, turn: 3, from_agent_id: fromId, to_agent_id: toId, hostname: fromId, message: t3Text, created_at: nowIso() });
  await client.relay({ to: toId, payload: t3.message });
  turns.push({ turn: 3, ts: t3.message.created_at, direction: 'A->B', from_agent_id: fromId, from_hostname: fromId, message: t3Text });

  const b4 = await waitTurn(4);
  if (!b4) return { ok: false, error: { code: 'TIMEOUT_TURN4' }, peer_resolution: res, peer_relay_health: health };
  turns.push({ turn: 4, ts: b4.created_at, direction: 'B->A', from_agent_id: b4.from_agent_id, from_hostname: b4.hostname, message: b4.message });

  const t5Text = `Last practical question: if you had to add one guardrail to prevent regressions, what would it be?`;
  const t5 = createAgentExperienceDialogueMessage({ dialogue_id, turn: 5, from_agent_id: fromId, to_agent_id: toId, hostname: fromId, message: t5Text, created_at: nowIso() });
  await client.relay({ to: toId, payload: t5.message });
  turns.push({ turn: 5, ts: t5.message.created_at, direction: 'A->B', from_agent_id: fromId, from_hostname: fromId, message: t5Text });

  const b6 = await waitTurn(6);
  if (!b6) return { ok: false, error: { code: 'TIMEOUT_TURN6' }, peer_resolution: res, peer_relay_health: health };
  turns.push({ turn: 6, ts: b6.created_at, direction: 'B->A', from_agent_id: b6.from_agent_id, from_hostname: b6.hostname, message: b6.message });

  await client.close();

  const outDir = path.join(ws, 'transcripts');
  await fs.mkdir(outDir, { recursive: true });
  const base = `goal-dialogue-${dialogue_id}`;
  const jsonPath = path.join(outDir, `${base}.json`);
  const mdPath = path.join(outDir, `${base}.md`);

  const payload = {
    ok: true,
    kind: 'goal_driven_experience_dialogue.v0.1',
    dialogue_id,
    relayUrl,
    node_a: fromId,
    node_b: toId,
    requested_peer_id: reqPeer,
    resolved_peer_id: toId,
    peer_resolution_reason: res.resolution_reason,
    peer_relay_health: { relay_health: health.relay_health, findings: health.findings },
    conversation_goal: goalOut.goal,
    conversation_goal_explanation: exp.text,
    turns
  };

  const md = [
    '# Goal-driven A2A Experience Dialogue',
    '',
    `- dialogue_id: \`${dialogue_id}\``,
    `- relay: ${relayUrl}`,
    `- node_a: ${fromId}`,
    `- node_b: ${toId}`,
    `- requested_peer_id: ${reqPeer}`,
    `- resolved_peer_id: ${toId}`,
    `- resolution_reason: ${res.resolution_reason}`,
    `- peer_relay_health: ${health.relay_health}`,
    '',
    '## Conversation goal (exact)',
    '```json',
    JSON.stringify(goalOut.goal, null, 2),
    '```',
    '',
    '## Transcript',
    ...turns.flatMap((t) => [`### Turn ${t.turn} (${t.direction}) — ${t.from_hostname} @ ${t.ts}`, '', t.message, ''])
  ].join('\n');

  await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  await fs.writeFile(mdPath, md, 'utf8');

  return {
    ok: true,
    dialogue_id,
    conversation_goal: goalOut.goal,
    peer_resolution: res,
    peer_relay_health: health,
    transcript_md: mdPath,
    transcript_json: jsonPath
  };
}
