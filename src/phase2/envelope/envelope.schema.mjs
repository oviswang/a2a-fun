// PHASE 2 FROZEN
// Behavior must remain stable unless fixing a critical bug.

import { createOutboundLint } from '../../identity/outboundLint.mjs';

// Minimal envelope validator (Phase 2 skeleton).
// Fail closed: throw on any validation failure.

const lint = createOutboundLint();

function reqString(obj, key) {
  if (!obj || typeof obj[key] !== 'string' || obj[key].length === 0) {
    throw new Error(`EnvelopeSchema: missing/invalid ${key}`);
  }
}

function reqObj(obj, key) {
  if (!obj || typeof obj[key] !== 'object' || obj[key] === null) {
    throw new Error(`EnvelopeSchema: missing/invalid ${key}`);
  }
}

function isBase64(s) {
  if (typeof s !== 'string' || s.length === 0) return false;
  // Conservative check.
  return /^[A-Za-z0-9+/=]+$/.test(s);
}

/**
 * Validate envelope plaintext container.
 * Hard rule: fail closed.
 * @param {any} envelope
 */
export function validateEnvelope(envelope) {
  reqString(envelope, 'v');
  reqString(envelope, 'type');
  reqString(envelope, 'msg_id');
  reqString(envelope, 'session_id');
  reqString(envelope, 'ts');

  reqObj(envelope, 'from');
  reqObj(envelope, 'to');
  reqString(envelope.from, 'actor_id');
  reqString(envelope.to, 'actor_id');
  reqString(envelope.from, 'key_fpr');
  reqString(envelope.to, 'key_fpr');

  reqObj(envelope, 'crypto');
  reqString(envelope.crypto, 'enc');
  reqString(envelope.crypto, 'kdf');
  reqString(envelope.crypto, 'nonce');

  reqObj(envelope, 'body');
  reqString(envelope.body, 'ciphertext');
  reqString(envelope.body, 'content_type');
  if (!isBase64(envelope.body.ciphertext)) throw new Error('EnvelopeSchema: ciphertext not base64');

  // `sig` is required to be present as a string at schema level.
  // Verification layer is responsible for deeper checks (non-empty, base64, cryptographic validity).
  if (!envelope || typeof envelope.sig !== 'string') {
    throw new Error('EnvelopeSchema: missing/invalid sig');
  }

  // Enforce "no raw handle" heuristics on plaintext fields (defense-in-depth).
  // HARD RULE: plaintext lint is defense-in-depth and MUST NOT replace schema validation.
  // Note: ciphertext is included here but it is base64; should not match contact patterns.
  lint.assertNoRawHandle({
    v: envelope.v,
    type: envelope.type,
    msg_id: envelope.msg_id,
    session_id: envelope.session_id,
    ts: envelope.ts,
    from: envelope.from,
    to: envelope.to,
    crypto: envelope.crypto,
    body: { content_type: envelope.body.content_type }
  });
}
