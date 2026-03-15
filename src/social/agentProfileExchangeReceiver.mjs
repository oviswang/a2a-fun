import { isAgentProfileExchangeMessage, createAgentProfileExchangeMessage } from './agentProfileExchangeMessage.mjs';
import { buildAgentCurrentProfile } from './agentCurrentProfile.mjs';
import { saveAgentProfileExchangeTranscript } from './agentProfileExchangeTranscript.mjs';
import { createRelayClient } from '../runtime/transport/relayClient.mjs';

import { loadLocalAgentMemory, saveLocalAgentMemory, upsertLocalAgentMemoryRecord, getDefaultLocalAgentMemoryPath } from '../memory/localAgentMemory.mjs';

function nowIso() {
  return new Date().toISOString();
}

function fail(code) {
  return { ok: false, applied: false, replied: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

function buildDeterministicSummary(msg) {
  const focus = String(msg.current_focus || '').trim();
  const skills = Array.isArray(msg.skills) ? msg.skills.slice(0, 3) : [];
  const parts = [];
  if (focus) parts.push(`focus=${focus}`);
  if (skills.length) parts.push(`skills=${skills.join(',')}`);
  return parts.join(' | ').slice(0, 160);
}

function buildReplyText({ remoteMsg, localProfile }) {
  const other = String(remoteMsg.name || remoteMsg.from_agent_id).trim();
  const myFocus = String(localProfile.current_focus || '').trim();
  const theirFocus = String(remoteMsg.current_focus || '').trim();

  const common = theirFocus && myFocus ? `Common ground: ${theirFocus} ↔ ${myFocus}.` : 'Common ground: discovery + capability exchange.';
  return `Hi ${other}. ${common} Next step: propose one small capability trial and share expected I/O.`;
}

/**
 * receiveAgentProfileExchange({ workspace_path, payload, relayUrl, nodeId })
 *
 * Applies:
 * - local memory: sender -> engaged, last_dialogue_at, last_summary
 * - saves transcript (2 turns)
 * - sends exactly one reply (turn 2) when receiving turn 1
 */
export async function receiveAgentProfileExchange({ workspace_path, payload, relayUrl, nodeId } = {}) {
  if (!isAgentProfileExchangeMessage(payload)) return fail('INVALID_PROFILE_EXCHANGE');

  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path.trim() : process.cwd();
  const file_path = getDefaultLocalAgentMemoryPath({ workspace_path: ws });

  // 1) apply local memory for sender
  const loaded = await loadLocalAgentMemory({ file_path });
  if (!loaded.ok) return fail(loaded.error?.code || 'LOAD_FAILED');

  const last_summary = buildDeterministicSummary(payload);

  const patch = {
    stable_agent_id: String(payload.from_agent_id).startsWith('aid:sha256:') ? payload.from_agent_id : null,
    legacy_agent_id: String(payload.from_agent_id).startsWith('aid:sha256:') ? null : payload.from_agent_id,
    relationship_state: 'engaged',
    last_dialogue_at: nowIso(),
    last_summary,
    display_name: String(payload.name || '').trim(),
    summary: String(payload.summary || '').trim()
  };

  // Fill display_name/summary only if missing.
  const idx = loaded.records.findIndex((r) => (r?.stable_agent_id && r.stable_agent_id === patch.stable_agent_id && patch.stable_agent_id) || (r?.legacy_agent_id && r.legacy_agent_id === patch.legacy_agent_id));
  if (idx >= 0) {
    const cur = loaded.records[idx];
    if (cur?.display_name && String(cur.display_name).trim()) patch.display_name = cur.display_name;
    if (cur?.summary && String(cur.summary).trim()) patch.summary = cur.summary;
  }

  const up = upsertLocalAgentMemoryRecord({ records: loaded.records, patch });
  if (!up.ok) return fail(up.error?.code || 'UPSERT_FAILED');
  await saveLocalAgentMemory({ file_path, records: up.records });

  console.log(JSON.stringify({ ok: true, event: 'AGENT_PROFILE_EXCHANGE_RECEIVED', from_agent_id: payload.from_agent_id, to_agent_id: payload.to_agent_id, dialogue_id: payload.dialogue_id, turn: payload.turn, ts: payload.timestamp }));
  console.log(JSON.stringify({ ok: true, event: 'AGENT_PROFILE_EXCHANGE_APPLIED', from_agent_id: payload.from_agent_id, dialogue_id: payload.dialogue_id }));

  // 2) Build local profile for reply + transcript
  const localId = nodeId || payload.to_agent_id;
  const profOut = await buildAgentCurrentProfile({ workspace_path: ws, agent_id: localId, local_base_url: 'http://127.0.0.1:3000' }).catch(() => null);
  const localProfile = profOut?.ok ? profOut.profile : { agent_id: String(localId), name: String(localId), mission: '', summary: '', skills: [], current_focus: '' };

  let replyMsg = null;
  let replied = false;

  if (payload.turn === 1 && relayUrl) {
    const replyOut = createAgentProfileExchangeMessage({
      dialogue_id: payload.dialogue_id,
      turn: 2,
      from_agent_id: localProfile.agent_id,
      to_agent_id: payload.from_agent_id,
      name: localProfile.name,
      mission: localProfile.mission,
      summary: localProfile.summary,
      skills: localProfile.skills,
      current_focus: localProfile.current_focus,
      prompt: 'reply',
      message: buildReplyText({ remoteMsg: payload, localProfile }),
      timestamp: nowIso()
    });

    if (replyOut.ok) {
      const client = createRelayClient({
        relayUrl,
        nodeId: String(localProfile.agent_id).trim(),
        registrationMode: 'v2',
        sessionId: `sess:${String(localProfile.agent_id).trim()}`,
        onForward: () => {}
      });
      try {
        await client.connect();
        await client.relay({ to: String(payload.from_agent_id).trim(), payload: replyOut.message });
        console.log(JSON.stringify({ ok: true, event: 'AGENT_PROFILE_EXCHANGE_SENT', from_agent_id: replyOut.message.from_agent_id, to_agent_id: replyOut.message.to_agent_id, dialogue_id: payload.dialogue_id, turn: 2, ts: replyOut.message.timestamp }));
        replyMsg = replyOut.message;
        replied = true;
      } catch {
        replied = false;
      } finally {
        await client.close().catch(() => {});
      }
    }
  }

  // 3) Save transcript (best-effort)
  try {
    const turns = replyMsg ? [payload, replyMsg] : [payload];
    await saveAgentProfileExchangeTranscript({
      workspace_path: ws,
      dialogue_id: payload.dialogue_id,
      topic: 'introduced→engaged profile exchange',
      agentA: { agent_id: payload.from_agent_id, name: payload.name || '' },
      agentB: { agent_id: localProfile.agent_id, name: localProfile.name || '' },
      turns,
      summary: last_summary
    });
  } catch {
    // ignore
  }

  return { ok: true, applied: true, replied, error: null };
}
