import { resolvePrincipalSource } from './principalResolver.mjs';
import { computeStableAgentId } from './stableAgentId.mjs';

function fail(code) {
  return { ok: false, stable_agent_id: null, principal_source: null, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export function resolveStableAgentIdentity({ context, agent_slug = 'default' } = {}) {
  const pr = resolvePrincipalSource({ context });
  if (!pr.ok || !pr.principal_source) return fail('PRINCIPAL_UNRESOLVED');

  const idOut = computeStableAgentId({ principal_source: pr.principal_source, agent_slug });
  if (!idOut.ok || !idOut.stable_agent_id) return fail(idOut.error?.code || 'STABLE_AGENT_ID_FAILED');

  return {
    ok: true,
    stable_agent_id: idOut.stable_agent_id,
    principal_source: pr.principal_source,
    error: null
  };
}
