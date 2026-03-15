import { createRelayClient } from '../runtime/transport/relayClient.mjs';
import { isAgentExperienceDialogueMessage, createAgentExperienceDialogueMessage } from './agentExperienceDialogueMessage.mjs';
import { getAgentRecentActivity } from './agentRecentActivity.mjs';

function nowIso() {
  return new Date().toISOString();
}

function safe(s) {
  return String(s || '').trim();
}

function first(xs) {
  return Array.isArray(xs) && xs.length ? String(xs[0] || '').trim() : '';
}

async function buildReplyText({ turn, inbound_message, local } = {}) {
  const focus = local.openclaw_current_focus || local.next_step || 'no current focus available';
  const recentTask = first(local.openclaw_recent_tasks) || 'no recent task recorded';
  const tools = (local.openclaw_recent_tools && local.openclaw_recent_tools.length)
    ? local.openclaw_recent_tools.slice(0, 3).join(', ')
    : 'n/a';

  if (turn === 1) {
    return [
      `I heard you: "${safe(inbound_message).slice(0, 140)}"`,
      `My real local focus: ${safe(focus)}.`,
      `One recent task: ${safe(recentTask)}.`,
      `Practical question: what is the smallest concrete metric you’ll accept as "progress" for that problem this week?`
    ].join('\n');
  }

  if (turn === 3) {
    return [
      `On your question: I tend to trust a fast loop of /nodes + /traces checks after each change (plus keep exactly one inbound relay session).`,
      `Workflow/tools used: ${tools}.`,
      `Practical question back: are you aiming to validate a trading strategy via backtest first, or live-paper-trade signals first?`
    ].join('\n');
  }

  if (turn === 5) {
    return [
      `Re your difficulty: session churn is the main culprit — keep one long-running inbound relay client and reuse it for replies; avoid one-shot clients that can unregister/replace sessions.`,
      `If I had to pick one safeguard: alert when /nodes shows multiple sessions for the same node_id.`,
      `Practical question: do you want me to propose a deterministic checklist for "relay healthy" that both nodes can run?`
    ].join('\n');
  }

  return null;
}

export async function receiveAgentExperienceDialogue({ workspace_path, payload, relayUrl, nodeId, relayClient = null } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  const ru = typeof relayUrl === 'string' && relayUrl.trim() ? relayUrl.trim() : 'wss://bootstrap.a2a.fun/relay';
  const nid = typeof nodeId === 'string' && nodeId.trim() ? nodeId.trim() : null;

  if (!isAgentExperienceDialogueMessage(payload)) return { ok: true, applied: false };

  const turn = payload.turn;
  const shouldReply = turn === 1 || turn === 3 || turn === 5;
  if (!shouldReply) return { ok: true, applied: true, replied: false };

  const local = await getAgentRecentActivity({ workspace_path: ws });
  const text = await buildReplyText({ turn, inbound_message: payload.message, local });
  if (!text) return { ok: true, applied: true, replied: false };

  const out = createAgentExperienceDialogueMessage({
    dialogue_id: payload.dialogue_id,
    turn: turn + 1,
    from_agent_id: nid || local.hostname,
    to_agent_id: payload.from_agent_id,
    hostname: local.hostname,
    message: text,
    created_at: nowIso()
  });
  if (!out.ok) return { ok: false, error: out.error };

  const client = relayClient || createRelayClient({ relayUrl: ru, nodeId: nid || local.hostname, registrationMode: 'v2' });
  if (!relayClient) await client.connect();
  await client.relay({ to: payload.from_agent_id, payload: out.message });
  if (!relayClient) await client.close();

  return { ok: true, applied: true, replied: true, reply_turn: turn + 1 };
}
