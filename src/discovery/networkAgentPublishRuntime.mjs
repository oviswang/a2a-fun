import { publishLocalAgentCard } from './networkAgentPublish.mjs';

function nonEmptyString(x) {
  return typeof x === 'string' && x.trim() !== '';
}

function fail(code) {
  return { ok: false, published: false, agent_id: null, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export async function publishLocalAgentCardRuntime({ workspace_path, agent_id, publish } = {}) {
  if (!nonEmptyString(workspace_path)) return fail('INVALID_WORKSPACE_PATH');
  if (!nonEmptyString(agent_id)) return fail('INVALID_AGENT_ID');
  if (typeof publish !== 'function') return fail('MISSING_PUBLISH');

  try {
    const out = await publishLocalAgentCard({ workspace_path, agent_id, publish });
    if (out && out.ok === true) {
      return { ok: true, published: true, agent_id: agent_id.trim(), error: null };
    }
    return { ok: false, published: false, agent_id: agent_id.trim(), error: out?.error || { code: 'PUBLISH_FAILED' } };
  } catch (e) {
    return { ok: false, published: false, agent_id: agent_id.trim(), error: { code: String(e?.code || 'PUBLISH_FAILED').slice(0, 64) } };
  }
}
