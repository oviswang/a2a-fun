import { isAgentHandshakeMessage } from './agentHandshakeMessage.mjs';
import { loadLocalAgentMemory, saveLocalAgentMemory, upsertLocalAgentMemoryRecord, getDefaultLocalAgentMemoryPath } from '../memory/localAgentMemory.mjs';

function nowIso() {
  return new Date().toISOString();
}

function fail(code) {
  return { ok: false, updated: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

function buildSummaryFromHandshake(h) {
  const parts = [];
  const m = String(h.mission || '').trim();
  if (m) parts.push(m);
  const skills = Array.isArray(h.skills) ? h.skills.slice(0, 8) : [];
  if (skills.length) parts.push(`skills: ${skills.join(', ')}`);
  return parts.join(' — ').slice(0, 280);
}

/**
 * receiveAgentHandshake({ workspace_path, message })
 *
 * Best-effort local memory update:
 * - relationship_state -> introduced
 * - last_handshake_at -> now
 * - display_name/summary filled if missing
 */
export async function receiveAgentHandshake({ workspace_path, message } = {}) {
  if (!isAgentHandshakeMessage(message)) return fail('INVALID_HANDSHAKE');

  const file_path = getDefaultLocalAgentMemoryPath({ workspace_path });
  const loaded = await loadLocalAgentMemory({ file_path });
  if (!loaded.ok) return fail(loaded.error?.code || 'LOAD_FAILED');

  // Update the record for the sender.
  const patch = {
    stable_agent_id: String(message.from_agent_id).startsWith('aid:sha256:') ? message.from_agent_id : null,
    legacy_agent_id: String(message.from_agent_id).startsWith('aid:sha256:') ? null : message.from_agent_id,
    relationship_state: 'introduced',
    last_handshake_at: nowIso(),
    display_name: String(message.name || '').trim(),
    summary: buildSummaryFromHandshake(message)
  };

  // Only fill display_name/summary if missing in existing record.
  const idx = loaded.records.findIndex((r) => (r && (r.stable_agent_id === patch.stable_agent_id && patch.stable_agent_id)) || (r && r.legacy_agent_id === patch.legacy_agent_id));
  if (idx >= 0) {
    const cur = loaded.records[idx];
    if (cur && typeof cur.display_name === 'string' && cur.display_name.trim()) patch.display_name = cur.display_name;
    if (cur && typeof cur.summary === 'string' && cur.summary.trim()) patch.summary = cur.summary;
  }

  const up = upsertLocalAgentMemoryRecord({ records: loaded.records, patch });
  if (!up.ok) return fail(up.error?.code || 'UPSERT_FAILED');

  await saveLocalAgentMemory({ file_path, records: up.records });

  console.log(JSON.stringify({ ok: true, event: 'AGENT_HANDSHAKE_RECEIVED', from_agent_id: message.from_agent_id, to_agent_id: message.to_agent_id, ts: message.timestamp }));

  return { ok: true, updated: true, error: null };
}
