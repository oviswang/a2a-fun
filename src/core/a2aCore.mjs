import { normalizeStandardMessage } from './standardMessage.mjs';
import { mapTextToTask } from '../intent/intentMapping.mjs';
import { bindChannelUserToAgentId, loadLocalAgentId, loadNodeId } from '../identity/identityBinding.mjs';

function ok(result) {
  return { status: 'ok', result, error: null };
}

function fail(code, detail) {
  return { status: 'error', result: null, error: { code, detail: detail || null } };
}

function nowIso() {
  return new Date().toISOString();
}

function renderHelp({ hint } = {}) {
  const lines = [
    'A2A core is online. Try:',
    '- ping',
    '- status / 帮我检查状态',
    '- 帮我找节点',
    '- help'
  ];
  if (hint) lines.push('', `You said: ${hint}`);
  return lines.join('\n');
}

async function executeTask({ task, args, context } = {}) {
  // Minimal tasks for cross-channel consistency tests.
  if (task === 'ping') return ok({ pong: true, at: nowIso() });

  if (task === 'runtime_status') {
    return ok({
      at: nowIso(),
      node_id: context?.node_id || null,
      local_agent_id: context?.local_agent_id || null,
      a2a_agent_id: context?.a2a_agent_id || null,
      channel: context?.channel || null,
      user_id: context?.user_id || null
    });
  }

  if (task === 'network_snapshot') {
    // Placeholder: real network discovery is outside this patch.
    return ok({ at: nowIso(), peers: [], note: 'network_snapshot not wired; returning empty set' });
  }

  if (task === 'help') return ok(renderHelp({ hint: args?.hint }));

  return fail('TASK_NOT_FOUND', task);
}

/**
 * A2A Core execution entrypoint.
 * - All channels MUST call this (directly or via their adapter).
 * - No channel logic allowed beyond normalize + formatting.
 */
export async function a2aCoreHandleMessage(standardMsg) {
  let msg;
  try {
    msg = normalizeStandardMessage(standardMsg);
  } catch (e) {
    return fail(e.code || 'INVALID_MESSAGE', e.message);
  }

  const node_id = loadNodeId() || null;
  const local_agent_id = loadLocalAgentId() || null;
  if (!node_id || !local_agent_id) {
    return fail('SELF_ID_UNKNOWN', 'missing data/node_id (and/or data/a2a_agent_id)');
  }

  const bind = bindChannelUserToAgentId({ channel: msg.channel, user_id: msg.user_id });
  const a2a_agent_id = bind?.agent_id || null;

  const mapped = mapTextToTask({ text: msg.text });
  if (!mapped?.ok) return fail('INTENT_MAPPING_FAILED', mapped?.error || null);

  const context = {
    node_id,
    local_agent_id,
    a2a_agent_id,
    channel: msg.channel,
    user_id: msg.user_id,
    metadata: msg.metadata
  };

  return executeTask({ task: mapped.task, args: mapped.args, context });
}
