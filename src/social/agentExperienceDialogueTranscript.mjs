import fs from 'node:fs/promises';
import path from 'node:path';

function nowIso() {
  return new Date().toISOString();
}

export function buildExperienceDialogueMarkdown({ dialogue_id, topic, node_a, node_b, turns, relayUrl } = {}) {
  const header = [
    '# Agent Experience Dialogue Transcript',
    '',
    `- dialogue_id: \`${dialogue_id}\``,
    `- topic: ${topic || ''}`,
    `- relay: ${relayUrl || ''}`,
    `- node_a: ${node_a?.hostname || ''} (\`${node_a?.agent_id || ''}\`)`,
    `- node_b: ${node_b?.hostname || ''} (\`${node_b?.agent_id || ''}\`)`,
    ''
  ].join('\n');

  const body = (turns || []).map((t) => {
    return [
      `## Turn ${t.turn} — ${t.from_hostname} (\`${t.from_agent_id}\`)`,
      '',
      `- hostname: ${t.from_hostname || ''}`,
      `- timestamp: ${t.ts || ''}`,
      `- relay_message_direction: ${t.direction || ''}`,
      '',
      'RAW MESSAGE:',
      t.message || '',
      ''
    ].join('\n');
  }).join('\n');

  return `${header}\n${body}`.trim() + '\n';
}

export async function saveExperienceDialogueTranscript({ workspace_path, dialogue_id, topic, relayUrl, node_a, node_b, turns } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  const dir = path.join(ws, 'transcripts');
  await fs.mkdir(dir, { recursive: true });

  const jsonPath = path.join(dir, `experience-dialogue-${dialogue_id}.json`);
  const mdPath = path.join(dir, `experience-dialogue-${dialogue_id}.md`);

  const payload = {
    ok: true,
    kind: 'experience_dialogue_transcript.v0.1',
    dialogue_id,
    topic,
    relayUrl,
    saved_at: nowIso(),
    node_a,
    node_b,
    turns
  };

  const md = buildExperienceDialogueMarkdown({ dialogue_id, topic, node_a, node_b, turns, relayUrl });

  await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  await fs.writeFile(mdPath, md, 'utf8');

  return { ok: true, transcript_json: jsonPath, transcript_md: mdPath };
}
