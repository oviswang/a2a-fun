import { createHash } from 'node:crypto';

/**
 * Outbound no-raw-handle lint.
 *
 * Requirements:
 * - Recursive: string / object / array
 * - Check BOTH keys and values
 * - On hit: throw (caller may catch and refuse-send)
 */

const DEFAULT_MAX_STRING_SCAN = 4096;

function isPlainObject(x) {
  return !!x && typeof x === 'object' && (x.constructor === Object || Object.getPrototypeOf(x) === null);
}

/**
 * Heuristic detectors.
 * NOTE: Phase 1 has no access to a user's raw handle; we detect common "contact-like" tokens.
 */
function findContactLikeToken(s) {
  if (!s) return null;
  const t = String(s);

  // Basic email.
  // (Intentionally not fully RFC compliant; keep it conservative.)
  const emailRe = /\b[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,255}\.[A-Z]{2,63}\b/i;
  if (emailRe.test(t)) return 'email';

  // E.164-like phone (allow spaces/hyphens, but require 8-15 digits total after '+').
  const plusIdx = t.indexOf('+');
  if (plusIdx !== -1) {
    const tail = t.slice(plusIdx + 1, plusIdx + 1 + 32);
    const digits = tail.replace(/[^0-9]/g, '');
    if (digits.length >= 8 && digits.length <= 15) return 'e164_phone';
  }

  // @handle tokens (telegram-ish / social).
  const atHandleRe = /(^|\s)@[a-zA-Z0-9_]{3,32}(\b|$)/;
  if (atHandleRe.test(t)) return 'at_handle';

  // Explicit messenger markers (heuristic but useful for preventing accidental contact exchange).
  const messengerRe = /(wechat|weixin|whatsapp|telegram)\s*[:=]\s*[^\s]{3,}/i;
  if (messengerRe.test(t)) return 'messenger_handle';

  // wa.me short links
  const waMeRe = /\bwa\.me\/[0-9]{6,}\b/i;
  if (waMeRe.test(t)) return 'whatsapp_link';

  // Very long digit sequences that look like phone/account ids.
  const longDigitsRe = /\b\d{10,}\b/;
  if (longDigitsRe.test(t)) return 'long_digits';

  return null;
}

function stablePreview(x) {
  const s = typeof x === 'string' ? x : JSON.stringify(x);
  const h = createHash('sha256').update(s).digest('hex').slice(0, 12);
  return `${typeof x}:${h}`;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.maxStringScan]
 */
export function createOutboundLint(opts = {}) {
  const maxStringScan = Number.isFinite(opts.maxStringScan) ? opts.maxStringScan : DEFAULT_MAX_STRING_SCAN;

  /**
   * @param {any} value
   * @param {string} [path]
   */
  function assertNoRawHandle(value, path = '$') {
    // null/undefined/boolean/number are safe.
    if (value == null) return;

    if (typeof value === 'string') {
      const s = value.length > maxStringScan ? value.slice(0, maxStringScan) : value;
      const hit = findContactLikeToken(s);
      if (hit) {
        const err = new Error(`OutboundLint: potential raw handle/contact token detected (${hit}) at ${path}; refusing outbound content.`);
        err.code = 'OUTBOUND_LINT_RAW_HANDLE';
        err.meta = { hit, path, preview: stablePreview(s) };
        throw err;
      }
      return;
    }

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        assertNoRawHandle(value[i], `${path}[${i}]`);
      }
      return;
    }

    if (isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) {
        // Check key
        assertNoRawHandle(k, `${path}.{key}`);
        // Check value
        assertNoRawHandle(v, `${path}.${k}`);
      }
      return;
    }

    // For other objects (Date, Buffer, etc), stringify shallowly.
    // We still want to catch accidental leakage.
    try {
      assertNoRawHandle(String(value), `${path}.{toString}`);
    } catch (e) {
      throw e;
    }
  }

  return { assertNoRawHandle };
}
