import { normalizePrincipalSource } from './stableAgentId.mjs';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function normGateway(x) {
  const s = typeof x === 'string' ? x.trim().toLowerCase() : '';
  return s || null;
}

function normAccountId(x) {
  const s = typeof x === 'string' ? x.trim() : '';
  return s || null;
}

/**
 * resolvePrincipalSource({ context })
 *
 * Best-effort principal resolution from runtime context.
 *
 * We intentionally do NOT persist principal_source anywhere; it's an internal
 * derivation root.
 */
export function resolvePrincipalSource({ context } = {}) {
  if (!isObj(context)) {
    return { ok: false, gateway: null, account_id: null, principal_source: null, error: { code: 'PRINCIPAL_UNRESOLVED' } };
  }

  const gateway = normGateway(context.gateway) || normGateway(context.channel) || null;

  // account_id: try explicit first, then common runtime fields.
  const account_id =
    normAccountId(context.account_id) ||
    normAccountId(context.sender_id) ||
    normAccountId(context.senderId) ||
    normAccountId(context.owner_id) ||
    normAccountId(context.ownerId) ||
    normAccountId(context.chat_id) ||
    normAccountId(context.channel_id) ||
    null;

  if (!gateway || !account_id) {
    return { ok: false, gateway, account_id, principal_source: null, error: { code: 'PRINCIPAL_UNRESOLVED' } };
  }

  const norm = normalizePrincipalSource({ gateway, account_id });
  if (!norm.ok) {
    return { ok: false, gateway, account_id, principal_source: null, error: { code: 'PRINCIPAL_UNRESOLVED' } };
  }

  return {
    ok: true,
    gateway,
    account_id,
    principal_source: norm.principal_source,
    error: null
  };
}
