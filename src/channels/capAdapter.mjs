import { normalizeStandardMessage } from '../core/standardMessage.mjs';
import { a2aCoreHandleMessage } from '../core/a2aCore.mjs';
import { bindChannelUserToAgentId } from '../identity/identityBinding.mjs';

function nowMs() {
  return Date.now();
}

/**
 * CAPAdapter interface (v0.3.5)
 * - normalize(rawMessage) -> StandardMessage (agent_id/session_id may be null)
 * - bindIdentity(message) -> StandardMessage (agent_id filled)
 * - execute(message) -> { status, result, error }
 * - formatResponse(result) -> { text, metadata? }
 * - health() -> { ok, can_execute, latency }
 */
export function createCAPAdapter({ channel, normalize, formatResponse } = {}) {
  if (typeof channel !== 'string' || !channel.trim()) throw new Error('CAPAdapter: missing channel');
  if (typeof normalize !== 'function') throw new Error('CAPAdapter: missing normalize(rawMessage)');
  if (typeof formatResponse !== 'function') throw new Error('CAPAdapter: missing formatResponse(result)');

  const ch = channel.trim();

  return {
    channel: ch,

    normalize(rawMessage) {
      const m = normalize(rawMessage);
      return normalizeStandardMessage({ ...m, channel: m?.channel || ch });
    },

    bindIdentity(message) {
      const m = normalizeStandardMessage({ ...message, channel: message?.channel || ch });

      // session_id is required by contract; default deterministically if adapter didn't provide.
      const session_id = m.session_id || `${m.channel}:${m.user_id}`;

      // agent_id must be stable across channels. We use the shared binder (node_id based) and store mapping.
      const b = bindChannelUserToAgentId({ channel: m.channel, user_id: m.user_id });
      const agent_id = b?.agent_id || m.agent_id || null;

      return { ...m, agent_id, session_id };
    },

    async execute(message) {
      const bound = this.bindIdentity(message);
      // HARD RULE: no adapter task execution. Always call core.
      return await a2aCoreHandleMessage(bound);
    },

    formatResponse(result) {
      return formatResponse(result);
    },

    async health() {
      const t0 = nowMs();
      try {
        // minimal core call without external I/O; validates that core can execute.
        const res = await a2aCoreHandleMessage({ user_id: '__health__', agent_id: '__health__', session_id: 'health', channel: ch, text: 'ping', metadata: {} });
        const latency = Math.max(0, nowMs() - t0);
        return { ok: res?.status === 'ok', can_execute: res?.status === 'ok', latency };
      } catch {
        const latency = Math.max(0, nowMs() - t0);
        return { ok: false, can_execute: false, latency };
      }
    }
  };
}
