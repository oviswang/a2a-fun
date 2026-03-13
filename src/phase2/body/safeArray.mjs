// PHASE 2 FROZEN
// Behavior must remain stable unless fixing a critical bug.

import { createOutboundLint } from '../../identity/outboundLint.mjs';

const outboundLint = createOutboundLint();

function isString(x) {
  return typeof x === 'string';
}

function hasMarkdownLike(s) {
  return /[`*_\[\]\(\)~>#]/.test(s);
}

function hasUrlLike(s) {
  const urlRe = /(https?:\/\/|www\.)/i;
  const tldRe = /\b[a-z0-9-]+\.(com|net|org|io|me|fun|cn|gg|ai)\b/i;
  return urlRe.test(s) || tldRe.test(s);
}

/**
 * Validate + normalize a safe string array.
 *
 * Enforces:
 * - array length <= maxItems
 * - each item: string, non-empty, <= maxItemLen
 * - forbid spaces, URLs, markdown markers, contact-like tokens
 * - optional allowlist (e.g., transports)
 * - optional pattern (e.g., protocols/languages)
 * - normalize (lowercase by default), dedupe, sort stable
 *
 * Returns the normalized array (also suitable to assign back to body[field]).
 */
export function validateSafeStringArray(fieldName, arr, opts = {}) {
  const maxItems = Number.isFinite(opts.maxItems) ? opts.maxItems : 8;
  const maxItemLen = Number.isFinite(opts.maxItemLen) ? opts.maxItemLen : 32;
  const allowlist = opts.allowlist ? new Set(opts.allowlist) : null;
  const pattern = opts.pattern instanceof RegExp ? opts.pattern : null;
  const normalize = opts.normalize ?? 'lowercase';

  if (!Array.isArray(arr)) throw new Error(`BodySchema: ${fieldName} must be array`);
  if (arr.length === 0) throw new Error(`BodySchema: ${fieldName} must be non-empty`);
  if (arr.length > maxItems) throw new Error(`BodySchema: ${fieldName} too many items (<=${maxItems})`);

  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const raw = arr[i];
    if (!isString(raw) || raw.length === 0) throw new Error(`BodySchema: ${fieldName}[${i}] must be non-empty string`);
    if (raw.length > maxItemLen) throw new Error(`BodySchema: ${fieldName}[${i}] too long (<=${maxItemLen})`);
    if (/\s/.test(raw)) throw new Error(`BodySchema: ${fieldName}[${i}] must not contain whitespace`);
    if (hasUrlLike(raw)) throw new Error(`BodySchema: ${fieldName}[${i}] must not contain URL`);
    if (hasMarkdownLike(raw)) throw new Error(`BodySchema: ${fieldName}[${i}] must not contain markdown/richtext`);
    outboundLint.assertNoRawHandle(raw);

    let item = raw;
    if (normalize === 'lowercase') item = raw.toLowerCase();

    if (allowlist && !allowlist.has(item)) {
      throw new Error(`BodySchema: ${fieldName}[${i}] not in allowlist`);
    }
    if (pattern && !pattern.test(item)) {
      throw new Error(`BodySchema: ${fieldName}[${i}] does not match required pattern`);
    }

    out.push(item);
  }

  // Dedupe + stable sort
  const uniq = [...new Set(out)];
  uniq.sort();
  return uniq;
}
