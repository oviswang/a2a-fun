// PHASE 2 FROZEN
// Behavior must remain stable unless fixing a critical bug.

import { createOutboundLint } from '../../identity/outboundLint.mjs';

const outboundLint = createOutboundLint();

/**
 * Safe short text policy (Phase 2).
 *
 * Enforces:
 * - string
 * - maxLen (default 160)
 * - single line
 * - outbound lint (contact-like token ban)
 * - no URLs (strict, temporary)
 * - no markdown/richtext markers (strict, temporary)
 */
export function validateSafeShortText(fieldName, value, opts = {}) {
  const maxLen = Number.isFinite(opts.maxLen) ? opts.maxLen : 160;

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`BodySchema: ${fieldName} required`);
  }
  if (value.length > maxLen) {
    throw new Error(`BodySchema: ${fieldName} too long (<=${maxLen})`);
  }
  if (/[\r\n]/.test(value)) {
    throw new Error(`BodySchema: ${fieldName} must be single-line`);
  }

  // No URLs (strict, temporary)
  const urlRe = /(https?:\/\/|www\.)/i;
  const tldRe = /\b[a-z0-9-]+\.(com|net|org|io|me|fun|cn|gg|ai)\b/i;
  if (urlRe.test(value) || tldRe.test(value)) {
    throw new Error(`BodySchema: ${fieldName} must not contain URL`);
  }

  // No markdown / richtext markers (strict, temporary)
  const mdRe = /[`*_\[\]\(\)~>#]/;
  if (mdRe.test(value)) {
    throw new Error(`BodySchema: ${fieldName} must not contain markdown/richtext`);
  }

  // Contact-like token ban
  outboundLint.assertNoRawHandle(value);
}
