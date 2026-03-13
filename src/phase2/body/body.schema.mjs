// PHASE 2 FROZEN
// Behavior must remain stable unless fixing a critical bug.

import {
  SUPPORTED_MESSAGE_TYPES_PHASE2,
  RESERVED_MESSAGE_TYPES_PHASE2,
  SUPPORTED_PROTOCOLS_PHASE2,
  SUPPORTED_TRANSPORTS_PHASE2
} from '../config/phase2.constants.mjs';
import { validateSafeShortText } from './safeText.mjs';
import { validateSafeStringArray } from './safeArray.mjs';

// Decrypted body schema validation (Phase 2 skeleton).
// Fail closed: throw on any validation failure.

function isPlainObject(x) {
  return !!x && typeof x === 'object' && (x.constructor === Object || Object.getPrototypeOf(x) === null);
}

/**
 * Validate decrypted body by message type.
 * This is intentionally minimal in Phase 2 skeleton.
 */
export function validateDecryptedBodyByType({ v, type, body }) {
  if (typeof v !== 'string' || !v) throw new Error('BodySchema: missing v');
  if (typeof type !== 'string' || !type) throw new Error('BodySchema: missing type');
  if (RESERVED_MESSAGE_TYPES_PHASE2.includes(type)) throw new Error(`BodySchema: reserved type not implemented in Phase 2: ${type}`);
  if (!SUPPORTED_MESSAGE_TYPES_PHASE2.includes(type)) throw new Error(`BodySchema: unknown type ${type}`);
  if (!isPlainObject(body)) throw new Error('BodySchema: body must be object');

  // Minimal per-type requirements (expand later).
  // For Phase 2, keep shapes strict and fail closed.

  if (type === 'probe.hello') {
    const allowed = ['protocols', 'transports', 'languages'];
    for (const k of Object.keys(body)) if (!allowed.includes(k)) throw new Error(`BodySchema: probe.hello unknown field ${k}`);

    // protocols: safe pattern, limited format
    body.protocols = validateSafeStringArray('probe.hello.protocols', body.protocols, {
      maxItems: 8,
      maxItemLen: 64,
      // Schema layer: must be a合法 a2a protocol name
      // ^a2a\.[a-z0-9._-]+/[0-9]+$
      pattern: /^a2a\.[a-z0-9._-]+\/[0-9]+$/i,
      normalize: 'lowercase'
    });

    // Phase 2 support layer: accept only supported protocol values
    for (const p of body.protocols) {
      if (!SUPPORTED_PROTOCOLS_PHASE2.includes(p)) {
        throw new Error(`BodySchema: probe.hello.protocols unsupported in Phase 2: ${p}`);
      }
    }

    // transports:
    // - schema layer: safe token format
    // - support layer: only allow SUPPORTED_TRANSPORTS_PHASE2
    if (body.transports != null) {
      body.transports = validateSafeStringArray('probe.hello.transports', body.transports, {
        maxItems: 5,
        maxItemLen: 16,
        pattern: /^[a-z0-9-]{1,16}$/i,
        normalize: 'lowercase'
      });

      for (const t of body.transports) {
        if (!SUPPORTED_TRANSPORTS_PHASE2.includes(t)) {
          throw new Error(`BodySchema: probe.hello.transports unsupported in Phase 2: ${t}`);
        }
      }
    }

    // languages: limited BCP47-ish
    if (body.languages != null) {
      body.languages = validateSafeStringArray('probe.hello.languages', body.languages, {
        maxItems: 5,
        maxItemLen: 16,
        // Conservative BCP47 subset: lang OR lang-region (2 letters each)
        pattern: /^[a-z]{2}(-[a-z]{2})?$/i,
        normalize: 'lowercase'
      });
    }
  }

  if (type === 'probe.question') {
    const allowed = ['q'];
    for (const k of Object.keys(body)) if (!allowed.includes(k)) throw new Error(`BodySchema: probe.question unknown field ${k}`);
    validateSafeShortText('probe.question.q', body.q, { maxLen: 160 });
  }

  if (type === 'probe.answer') {
    const allowed = ['a'];
    for (const k of Object.keys(body)) if (!allowed.includes(k)) throw new Error(`BodySchema: probe.answer unknown field ${k}`);
    validateSafeShortText('probe.answer.a', body.a, { maxLen: 160 });
  }

  if (type === 'probe.summary') {
    const allowed = ['summary', 'risk_flags', 'suggested_action'];
    for (const k of Object.keys(body)) if (!allowed.includes(k)) throw new Error(`BodySchema: probe.summary unknown field ${k}`);

    validateSafeShortText('probe.summary.summary', body.summary, { maxLen: 160 });

    if (body.risk_flags != null) {
      if (!Array.isArray(body.risk_flags) || body.risk_flags.some(x => typeof x !== 'string')) throw new Error('BodySchema: probe.summary.risk_flags must be string[]');
    }
    if (body.suggested_action != null && typeof body.suggested_action !== 'string') throw new Error('BodySchema: probe.summary.suggested_action must be string');
  }

  if (type === 'probe.done') {
    const allowed = ['done'];
    for (const k of Object.keys(body)) if (!allowed.includes(k)) throw new Error(`BodySchema: probe.done unknown field ${k}`);
    if (body.done !== true) throw new Error('BodySchema: probe.done.done must be true');
  }

  if (type === 'human.entry') {
    const allowed = ['entered', 'entry_id', 'note', 'bind'];
    for (const k of Object.keys(body)) if (!allowed.includes(k)) throw new Error(`BodySchema: human.entry unknown field ${k}`);
    if (body.entered !== true) throw new Error('BodySchema: human.entry.entered must be true');
    if (!body.bind || typeof body.bind !== 'object') throw new Error('BodySchema: human.entry.bind required');
    if (typeof body.bind.session_id !== 'string') throw new Error('BodySchema: human.entry.bind.session_id required');
    if (typeof body.bind.probe_transcript_hash !== 'string') throw new Error('BodySchema: human.entry.bind.probe_transcript_hash required');
  }

  if (type === 'session.close') {
    const allowed = ['reason', 'final'];
    for (const k of Object.keys(body)) if (!allowed.includes(k)) throw new Error(`BodySchema: session.close unknown field ${k}`);
    const reasons = [
      'NO_HUMAN_ENTRY_TIMEOUT',
      'PROBE_TIMEOUT',
      'USER_CLOSE',
      'POLICY_REJECT',
      'TRANSPORT_FAIL',
      'PROTOCOL_VIOLATION'
    ];
    if (typeof body.reason !== 'string' || !reasons.includes(body.reason)) throw new Error('BodySchema: session.close.reason invalid');
    if (body.final !== true) throw new Error('BodySchema: session.close.final must be true');
  }

  if (type === 'error') {
    // error MUST be machine-safe only: no free-text details, no echo.
    const allowed = ['code', 'reason'];
    for (const k of Object.keys(body)) if (!allowed.includes(k)) throw new Error(`BodySchema: error unknown field ${k}`);
    const codes = ['VERSION_MISMATCH', 'VALIDATION_FAILED', 'UNAUTHORIZED', 'INTERNAL'];
    if (typeof body.code !== 'string' || !codes.includes(body.code)) throw new Error('BodySchema: error.code invalid');
    const reasons = ['SCHEMA', 'SIGNATURE', 'DECRYPT', 'POLICY', 'UNKNOWN'];
    if (typeof body.reason !== 'string' || !reasons.includes(body.reason)) throw new Error('BodySchema: error.reason invalid');
  }

  if (type === 'friendship.establish') {
    const allowed = ['peer_actor_id', 'session_id', 'created_at'];
    for (const k of Object.keys(body)) if (!allowed.includes(k)) throw new Error(`BodySchema: friendship.establish unknown field ${k}`);
    if (typeof body.peer_actor_id !== 'string' || body.peer_actor_id.length === 0) throw new Error('BodySchema: friendship.establish.peer_actor_id required');
    if (typeof body.session_id !== 'string' || body.session_id.length === 0) throw new Error('BodySchema: friendship.establish.session_id required');
    if (body.created_at != null && typeof body.created_at !== 'string') throw new Error('BodySchema: friendship.establish.created_at must be string');
  }
}
