import fs from 'node:fs/promises';
import path from 'node:path';

function nowIso() {
  return new Date().toISOString();
}

export function buildActivityDialogueMarkdown({ dialogue_id, node_a, node_b, turns } = {}) {
  const header = [
    '# Agent Activity Dialogue Transcript',
    '',
    `- dialogue_id: \`${dialogue_id}\``,
    `- node_a: ${node_a?.hostname || ''} (\`${node_a?.agent_id || ''}\`)`,
    `- node_b: ${node_b?.hostname || ''} (\`${node_b?.agent_id || ''}\`)`,
    ''
  ].join('\n');

  const body = (turns || [])
    .map((t) => {
      return [
        `## Turn ${t.turn} — ${t.from_hostname} (\`${t.from_agent_id}\`)`,
        '',
        `- hostname: ${t.from_hostname || ''}`,
        `- timestamp: ${t.ts || ''}`,
        `- relay_direction: ${t.direction || ''}`,
        '',
        'RAW MESSAGE:',
        t.message,
        ''
      ].join('\n');
    })
    .join('\n');

  return `${header}\n${body}`.trim() + '\n';
}

export async function saveActivityDialogueTranscript({ workspace_path, dialogue_id, node_a, node_b, turns } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  const dir = path.join(ws, 'transcripts');
  await fs.mkdir(dir, { recursive: true });

  const jsonPath = path.join(dir, `activity-dialogue-${dialogue_id}.json`);
  const mdPath = path.join(dir, `activity-dialogue-${dialogue_id}.md`);

  const payload = {
    ok: true,
    kind: 'activity_dialogue_transcript.v0.1',
    dialogue_id,
    saved_at: nowIso(),
    node_a,
    node_b,
    turns
  };

  const md = buildActivityDialogueMarkdown({ dialogue_id, node_a, node_b, turns });

  await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  await fs.writeFile(mdPath, md, 'utf8');

  return { ok: true, transcript_json: jsonPath, transcript_md: mdPath };
}
