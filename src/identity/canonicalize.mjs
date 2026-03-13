import { createHash } from 'node:crypto';

/**
 * Spec v0.4.3 (FROZEN):
 * canon = "a2a:v1:" + provider + ":" + normalized_account
 * actor_id = "h:sha256:" + sha256hex(UTF8(canon))
 */

const PROVIDER_RE = /^[a-z0-9_-]+$/;

export function normalizeProvider(provider) {
  if (typeof provider !== 'string') throw new Error('provider must be a string');
  const p = provider.trim().toLowerCase();
  if (!PROVIDER_RE.test(p)) throw new Error(`invalid provider: ${provider}`);
  return p;
}

export function normalizeAccount(provider, accountRaw) {
  const p = normalizeProvider(provider);
  if (typeof accountRaw !== 'string') throw new Error('account must be a string');
  const a0 = accountRaw.trim();

  if (p === 'whatsapp') {
    const compact = a0.replace(/[\s-]/g, '');
    if (!/^\+\d{8,15}$/.test(compact)) throw new Error('whatsapp account must be E.164 +[8-15 digits]');
    return compact;
  }

  if (p === 'telegram') {
    let u = a0;
    if (u.startsWith('@')) u = u.slice(1);
    u = u.toLowerCase();
    // MUST NOT start with a digit.
    if (!/^[a-z_][a-z0-9_]{4,31}$/.test(u)) throw new Error('telegram username must match [a-z_][a-z0-9_]{4,31}');
    return u;
  }

  if (p === 'email') {
    const e = a0.toLowerCase();
    if (/\s/.test(e)) throw new Error('email must not contain whitespace');
    // Minimal sanity check only.
    if (!/^.{1,64}@.{1,255}$/.test(e) || !e.includes('.')) throw new Error('email looks invalid');
    return e;
  }

  if (p === 'a2a') {
    const s = a0;
    if (/\s/.test(s)) throw new Error('a2a opaque id must not contain whitespace');
    // Keep it simple for Phase 1.
    if (s.length < 3 || s.length > 128) throw new Error('a2a opaque id length invalid');
    return s;
  }

  // Unknown provider: enforce conservative normalization.
  const generic = a0;
  if (!generic) throw new Error('account must not be empty');
  if (/\s/.test(generic)) throw new Error('generic account must not contain whitespace');
  return generic;
}

export function makeCanon(provider, normalizedAccount) {
  const p = normalizeProvider(provider);
  if (typeof normalizedAccount !== 'string' || !normalizedAccount) throw new Error('normalizedAccount required');
  return `a2a:v1:${p}:${normalizedAccount}`;
}

export function sha256HexUtf8(s) {
  return createHash('sha256').update(String(s), 'utf8').digest('hex');
}

export function deriveActorIdFromCanon(canon) {
  const hex = sha256HexUtf8(canon);
  return `h:sha256:${hex}`;
}

export function deriveActorId(provider, accountRaw) {
  const normalized = normalizeAccount(provider, accountRaw);
  const canon = makeCanon(provider, normalized);
  return {
    actor_id: deriveActorIdFromCanon(canon),
    provider: normalizeProvider(provider),
    normalized_account: normalized,
    canon
  };
}
