import fs from 'node:fs/promises';
import path from 'node:path';

import { isAgentProfileExchangeMessage } from './agentProfileExchangeMessage.mjs';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function fail(code) {
  return { ok: false, paths: null, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

function toMd({ dialogue_id, topic, a, b, turns, summary }) {
  const lines = [];
  lines.push('# Agent Profile Exchange Transcript');
  lines.push('');
  lines.push('- dialogue_id: `' + dialogue_id + '`');
  lines.push('- topic: ' + String(topic || '').trim());
  lines.push('- agentA: ' + String(a?.name || a?.agent_id || '') + ' (`' + String(a?.agent_id || '') + '`)');
  lines.push('- agentB: ' + String(b?.name || b?.agent_id || '') + ' (`' + String(b?.agent_id || '') + '`)');
  lines.push('');

  for (const m of turns) {
    lines.push('## Turn ' + m.turn + ' — ' + m.from_agent_id);
    lines.push('');
    lines.push(String(m.message || '').trim());
    lines.push('');
  }

  if (summary) {
    lines.push('---');
    lines.push('Summary: ' + summary);
    lines.push('');
  }

  return lines.join('\n');
}

export async function saveAgentProfileExchangeTranscript({ workspace_path, dialogue_id, topic, agentA, agentB, turns, summary } = {}) {
  if (typeof workspace_path !== 'string' || !workspace_path.trim()) return fail('INVALID_WORKSPACE_PATH');
  if (typeof dialogue_id !== 'string' || !dialogue_id.trim()) return fail('INVALID_DIALOGUE_ID');
  if (!isObj(agentA) || !isObj(agentB)) return fail('INVALID_AGENT');
  if (!Array.isArray(turns) || turns.some((m) => !isAgentProfileExchangeMessage(m))) return fail('INVALID_TURNS');

  const base = workspace_path.trim();
  const dir = path.join(base, 'transcripts');
  await fs.mkdir(dir, { recursive: true });

  const safeId = String(dialogue_id).replace(/[^a-zA-Z0-9:_\-]/g, '_');
  const jsonPath = path.join(dir, `profile-exchange-${safeId}.json`);
  const mdPath = path.join(dir, `profile-exchange-${safeId}.md`);

  const payload = {
    ok: true,
    kind: 'AGENT_PROFILE_EXCHANGE_TRANSCRIPT',
    dialogue_id,
    topic: String(topic || '').slice(0, 120),
    agentA,
    agentB,
    turns,
    summary: String(summary || '').slice(0, 280)
  };

  await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2));
  await fs.writeFile(mdPath, toMd({ dialogue_id, topic, a: agentA, b: agentB, turns, summary: payload.summary }));

  return { ok: true, paths: { json: jsonPath, md: mdPath }, error: null };
}
