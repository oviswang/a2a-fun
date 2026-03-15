import { createHash } from 'node:crypto';

function nonEmptyString(x) {
  return typeof x === 'string' && x.trim() !== '';
}

function fail(code) {
  return { ok: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

/**
 * normalizePrincipalSource({ gateway, account_id })
 *
 * Normalized shape:
 *   "<gateway>:<normalized_account_id>"
 */
export function normalizePrincipalSource({ gateway, account_id } = {}) {
  if (!nonEmptyString(gateway)) return fail('INVALID_GATEWAY');
  if (!nonEmptyString(account_id)) return fail('INVALID_ACCOUNT_ID');

  const g = gateway.trim().toLowerCase();
  const id = String(account_id).trim();

  // Fail closed on separators that would make the canonical form ambiguous.
  if (!g || g.includes(':') || g.includes('|')) return fail('INVALID_GATEWAY');
  if (!id || id.includes('|')) return fail('INVALID_ACCOUNT_ID');

  return { ok: true, principal_source: `${g}:${id}` };
}

function sha256hex(s) {
  return createHash('sha256').update(String(s), 'utf8').digest('hex');
}

/**
 * computeStableAgentId({ principal_source, agent_slug="default" })
 *
 * Computes sha256(principal_source + "|" + agent_slug + "|v1")
 *
 * Output shape:
 *   aid:sha256:<64-hex>
 */
export function computeStableAgentId({ principal_source, agent_slug = 'default' } = {}) {
  if (!nonEmptyString(principal_source)) return fail('INVALID_PRINCIPAL_SOURCE');
  if (!nonEmptyString(agent_slug)) return fail('INVALID_AGENT_SLUG');

  const ps = principal_source.trim();
  const slug = String(agent_slug).trim();

  if (ps.includes('|')) return fail('INVALID_PRINCIPAL_SOURCE');
  if (slug.includes('|')) return fail('INVALID_AGENT_SLUG');

  const material = `${ps}|${slug}|v1`;
  const hex = sha256hex(material);

  return { ok: true, stable_agent_id: `aid:sha256:${hex}` };
}

export function isStableAgentId(value) {
  if (!nonEmptyString(value)) return false;
  return /^aid:sha256:[0-9a-f]{64}$/.test(value.trim());
}
