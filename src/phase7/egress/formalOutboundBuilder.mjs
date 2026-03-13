import { validateDecryptedBodyByType } from '../../phase2/body/body.schema.mjs';
import { validateEnvelope } from '../../phase2/envelope/envelope.schema.mjs';

const PHASE7_ENVELOPE_VERSION = '0.4.4';
const SUPPORTED_EGRESS_TYPES = ['probe.question', 'probe.done'];

/**
 * Phase 7: Minimal formal outbound builder.
 *
 * Purpose:
 * - Prepares a FORMAL Phase 2 envelope for outbound transport.
 * - This module MUST NOT perform transport send.
 *
 * Hard caller requirements:
 * - builder DOES NOT generate msg_id or ts (caller must provide both).
 *
 * Dependency contracts (write these in stone):
 * - encrypt(...) MUST return an object with:
 *   ciphertext, nonce, enc, kdf, content_type
 * - sign({ envelope_without_sig }) MUST return a non-empty BASE64 signature string
 */
export async function buildFormalOutboundEnvelope({
  session_id,
  msg_id,
  ts,
  from_actor_id,
  to_actor_id,
  from_key_fpr,
  to_key_fpr,
  type,
  body,
  encrypt,
  sign
}) {
  // Input validation (fail closed)
  if (!session_id) throw new Error('FormalOutbound: missing session_id');
  if (!msg_id) throw new Error('FormalOutbound: missing msg_id');
  if (!ts) throw new Error('FormalOutbound: missing ts');
  if (!from_actor_id) throw new Error('FormalOutbound: missing from_actor_id');
  if (!to_actor_id) throw new Error('FormalOutbound: missing to_actor_id');
  if (!from_key_fpr) throw new Error('FormalOutbound: missing from_key_fpr');
  if (!to_key_fpr) throw new Error('FormalOutbound: missing to_key_fpr');
  if (!type) throw new Error('FormalOutbound: missing type');
  if (typeof encrypt !== 'function') throw new Error('FormalOutbound: missing encrypt');
  if (typeof sign !== 'function') throw new Error('FormalOutbound: missing sign');

  if (!SUPPORTED_EGRESS_TYPES.includes(type)) {
    throw new Error(`FormalOutbound: unsupported outbound type: ${type}`);
  }

  // Validate outbound body using frozen Phase 2 body schema.
  validateDecryptedBodyByType({ v: PHASE7_ENVELOPE_VERSION, type, body });

  // Encrypt (opaque to this module; must fail closed on error)
  const encRes = await encrypt({
    v: PHASE7_ENVELOPE_VERSION,
    type,
    body,
    session_id,
    msg_id,
    ts,
    from: { actor_id: from_actor_id, key_fpr: from_key_fpr },
    to: { actor_id: to_actor_id, key_fpr: to_key_fpr }
  });

  if (!encRes || typeof encRes !== 'object') throw new Error('FormalOutbound: encrypt returned invalid result');
  const { ciphertext, nonce, content_type, enc, kdf } = encRes;
  if (!ciphertext) throw new Error('FormalOutbound: encrypt missing ciphertext');
  if (!nonce) throw new Error('FormalOutbound: encrypt missing nonce');
  if (!content_type) throw new Error('FormalOutbound: encrypt missing content_type');
  if (!enc) throw new Error('FormalOutbound: encrypt missing enc');
  if (!kdf) throw new Error('FormalOutbound: encrypt missing kdf');

  const envelope_without_sig = {
    v: PHASE7_ENVELOPE_VERSION,
    type,
    msg_id,
    session_id,
    ts,
    from: { actor_id: from_actor_id, key_fpr: from_key_fpr },
    to: { actor_id: to_actor_id, key_fpr: to_key_fpr },
    crypto: { enc, kdf, nonce },
    body: { ciphertext, content_type }
  };

  const sig = await sign({ envelope_without_sig });
  if (typeof sig !== 'string' || sig.length === 0) throw new Error('FormalOutbound: sign returned invalid sig');
  if (!isBase64(sig)) throw new Error('FormalOutbound: sig not base64');

  const envelope = { ...envelope_without_sig, sig };

  // Defense-in-depth: validate plaintext envelope shape + outbound lint (frozen Phase 2 validator).
  validateEnvelope(envelope);

  return { status: 'FORMAL_ENVELOPE_READY', envelope };
}

export const PHASE7_SUPPORTED_EGRESS_TYPES = [...SUPPORTED_EGRESS_TYPES];

function isBase64(s) {
  if (typeof s !== 'string' || s.length === 0) return false;
  return /^[A-Za-z0-9+/=]+$/.test(s);
}
