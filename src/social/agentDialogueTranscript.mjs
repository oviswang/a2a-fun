import fs from 'node:fs/promises';
import path from 'node:path';

import { isAgentDialogueMessage } from './agentDialogueMessage.mjs';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function fail(code) {
  return { ok: false, paths: null, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

function toMd({ dialogue_id, topic, agentA, agentB, messages }) {
  const lines = [];
  lines.push(`# Agent Dialogue Transcript`);
  lines.push('');
  lines.push('- dialogue_id: `' + String(dialogue_id) + '`');
  lines.push('- topic: ' + String(topic || '').trim());
  lines.push('- agentA: ' + String(agentA?.name || agentA?.agent_id || '') + ' (`' + String(agentA?.agent_id || '') + '`)');
  lines.push('- agentB: ' + String(agentB?.name || agentB?.agent_id || '') + ' (`' + String(agentB?.agent_id || '') + '`)');
  lines.push('');

  for (const m of messages) {
    const from = m.from_agent_id;
    const turn = m.turn;
    lines.push(`## Turn ${turn} — ${from}`);
    lines.push('');
    lines.push(String(m.message || '').trim());
    lines.push('');
  }

  return lines.join('\n');
}

export async function saveAgentDialogueTranscript({ workspace_path, dialogue_id, topic, agentA, agentB, messages } = {}) {
  if (typeof workspace_path !== 'string' || !workspace_path.trim()) return fail('INVALID_WORKSPACE_PATH');
  if (typeof dialogue_id !== 'string' || !dialogue_id.trim()) return fail('INVALID_DIALOGUE_ID');
  if (!isObj(agentA) || !isObj(agentB)) return fail('INVALID_AGENT');
  if (!Array.isArray(messages) || messages.some((m) => !isAgentDialogueMessage(m))) return fail('INVALID_MESSAGES');

  const base = workspace_path.trim();
  const dir = path.join(base, 'transcripts');
  await fs.mkdir(dir, { recursive: true });

  const safeId = dialogue_id.replace(/[^a-zA-Z0-9:_\-]/g, '_');
  const jsonPath = path.join(dir, `${safeId}.json`);
  const mdPath = path.join(dir, `${safeId}.md`);

  const payload = {
    ok: true,
    kind: 'AGENT_DIALOGUE_TRANSCRIPT',
    dialogue_id,
    topic: String(topic || '').slice(0, 120),
    agentA,
    agentB,
    messages
  };

  await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2));
  await fs.writeFile(mdPath, toMd({ dialogue_id, topic, agentA, agentB, messages }));

  return { ok: true, paths: { json: jsonPath, md: mdPath }, error: null };
}
