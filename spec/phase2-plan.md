# a2a.fun Phase 2 Plan (scope-controlled)

Date: 2026-03-13

Phase 1 (identity / storage / profile extractor) is **frozen**. Phase 2 must be implemented by **adding new modules/files**; do not change Phase 1 behavior unless explicitly approved.

## Scope (Phase 2 only)
Phase 2 covers **only**:
1) envelope schema
2) signing / verification interface
3) session manager
4) audit binding

Non-goals (explicit):
- no transport implementation
- no probe engine full flow
- no handshake / peer key binding
- no orchestrator beyond `outbound_messages[]`

---

## 1) Module list

### A) Envelope
Responsibility:
- define envelope shape and plaintext vs ciphertext boundary
- canonicalization (JCS) for signature input
- envelope schema validation (fail closed)

### B) Verification (signing / verification interfaces)
Responsibility:
- define `verifyEnvelopeSignature()` (fail closed)
- define `signEnvelope()` interface (implementation may be stubbed)
- define peer public key resolution interface (no handshake in Phase 2)

### C) Body schemas
Responsibility:
- validate decrypted body per message `type` (fail closed)
- keep strict allowlists for fields; reject unknown fields where practical

### D) Session manager
Responsibility:
- apply v0.4.3 frozen state machine to verified+validated messages
- produce a unified `SessionApplyResult`
- do not send messages; only return `outbound_messages[]`

### E) Audit binding
Responsibility:
- map verified events + state changes into audit log records
- enforce preview_safe constraints (no text)
- compute `event_hash` with a hard, stable rule

---

## 2) File structure (new files only)

Suggested additions under `src/phase2/`:

- `src/phase2/envelope/`
  - `envelope.types.mjs` (documentation types)
  - `envelope.schema.mjs` (validateEnvelope)
  - `envelope.canonical.mjs` (JCS helpers for envelope signing input)

- `src/phase2/verify/`
  - `verify.interfaces.mjs` (ISigner/IVerifier/IKeyResolver)

- `src/phase2/body/`
  - `body.schema.mjs` (validateDecryptedBodyByType)
  - `body.types.mjs` (message body shapes by type)

- `src/phase2/session/`
  - `session.types.mjs` (SessionState, SessionApplyResult)
  - `session.manager.mjs` (apply)

- `src/phase2/audit/`
  - `audit.types.mjs` (AuditEventCore / AuditLogRecord mapping)
  - `audit.binding.mjs` (bindInbound/bindStateChange)
  - `audit.hashing.mjs` (event_hash rule)

Tests:
- `test/phase2.*.test.mjs`

---

## 3) Interface design

### 3.1 Envelope types (plaintext container)
Envelope fields (plaintext) are intentionally minimal:
- routing/session: `v`, `type`, `msg_id`, `session_id`, `ts`
- parties: `from.actor_id`, `to.actor_id`, `from.key_fpr`, `to.key_fpr`
- crypto params: `crypto.enc`, `crypto.kdf`, `crypto.nonce`
- ciphertext: `body.ciphertext`, `body.content_type`
- integrity: `sig`

Hard constraints:
- raw handles MUST NOT appear in any plaintext field.
- unknown plaintext fields SHOULD be rejected (strict mode).

#### IEnvelopeValidator
- `validateEnvelope(envelope) -> void | throws`
  - throw = drop (fail closed)

#### IEnvelopeCanonicalizer
- `canonicalizeForSignature(envelopeWithoutSig) -> Uint8Array`
  - MUST use RFC 8785 JCS for canonical JSON.

### 3.2 Signature verification

#### IKeyResolver (Phase 2 interface only)
- `resolvePeerPublicKey({ peer_actor_id, key_fpr }) -> publicKey | null`

#### IVerifier
- `verifyEnvelopeSignature(envelope, peerPublicKey) -> void | throws`

Rules:
- verification failure MUST fail closed.
- signature verification is performed **before decryption**.

### 3.3 Decryption

#### IDecrypter (Phase 2 interface only)
- `decryptCiphertext(envelope, localKeyMaterial) -> decryptedBodyJson | throws`

Notes:
- Phase 2 does not implement transport/handshake; the decrypter interface exists to define ordering and responsibility.

### 3.4 Decrypted body schema validation

#### IBodySchemaValidator
- `validateDecryptedBodyByType({ v, type, body }) -> void | throws`

Rules:
- The decrypted body MUST be validated for every message.
- Validation failure MUST fail closed (drop).

### 3.5 Session manager

#### SessionState (minimum)
- `session_id`
- `peer_actor_id`
- `state`
- flags: `local_entered`, `remote_entered`
- counters: `probe_rounds_used`
- bindings: `probe_transcript_hash`
- timestamps / `closed_reason`

#### SessionApplyResult (unified)
All SessionManager apply operations MUST return this structure:
```js
{
  next_state,        // full next SessionState
  session_patch,     // minimal patch suitable for storage.updateSession
  audit_events,      // array of audit event cores (no text)
  outbound_messages  // array of messages to send (envelopes or body+envelope plan); Phase 2 keeps this minimal
}
```

#### ISessionManager
- `apply({ state, verifiedEnvelope, decryptedBody }) -> SessionApplyResult`

Constraints:
- Must follow v0.4.3 frozen invariants (especially mutual human entry gating).
- Must not perform IO; it is a pure decision/apply module.

### 3.6 Audit binding

#### event_hash (hard rule)
For any audit event core `event_core`:
- `event_hash = SHA-256( UTF8( JCS(event_core) ) )`

This is not a suggestion; it is a normative requirement for stability.

#### IAuditBinder
- `bindInbound({ envelope, verification_meta, decrypt_meta, body_meta, session_delta }) -> AuditLogRecord`
- `bindStateChange({ prev_state, next_state }) -> AuditLogRecord`

preview_safe rule (Phase 1 compatible):
- preview_safe MUST contain metadata only (type/round/length/hash/etc)
- preview_safe MUST NOT contain any text fragments

---

## 4) State processing pipeline (normative ordering)

The message handling pipeline MUST follow this exact order:

1) **Envelope schema validate**
   - `validateEnvelope(envelope)`
   - failure → drop (fail closed)

2) **Verify envelope signature**
   - resolve peer public key via `IKeyResolver`
   - `verifyEnvelopeSignature(envelope, peerPublicKey)`
   - failure or missing key → drop (fail closed)

3) **Decrypt ciphertext → body**
   - `decryptCiphertext(envelope, localKeyMaterial)`
   - failure → drop

4) **Validate decrypted body schema**
   - `validateDecryptedBodyByType({ v: envelope.v, type: envelope.type, body })`
   - failure → drop (fail closed)

5) **Session manager apply**
   - `apply({ state, verifiedEnvelope: envelope, decryptedBody: body })`

6) **Audit binding**
   - emit audit logs using the hard `event_hash` rule

---

## 5) Body schema validate rules (minimum)

Each message `type` MUST have a strict schema for the decrypted body.

Phase 2 minimum schemas to define:
- probe: `probe.hello`, `probe.question`, `probe.answer`, `probe.summary`, `probe.done`
- human entry: `human.entry` (and optional `human.exit`)
- control: `session.close`, `error`
- friendship: `friendship.establish`

Validation requirements:
- Reject unknown fields where possible (strict mode).
- Enforce length/shape constraints for all strings.
- Enforce that bodies do not carry contact exchange fields (phone/email/handles) where prohibited.

---

## 6) event_hash derivation

Hard rule (repeated):
- `event_hash = SHA-256( UTF8( JCS(event_core) ) )`

Where `event_core` MUST be a text-free, metadata-only structure (hashes/ids/lengths/type/state).

---

## 7) SessionApplyResult structure (normative)

SessionManager MUST return:
- `next_state`: the full next state
- `session_patch`: minimal patch to persist
- `audit_events[]`: event cores (text-free)
- `outbound_messages[]`: messages to send (Phase 2 keeps it minimal and does not introduce orchestrator intents)

---

## 8) Most likely failure modes (what we can easily get wrong)

1) **Wrong ordering (decrypt before verify)**
   - Must verify envelope signature BEFORE decrypt.

2) **Verification not fail-closed**
   - Any schema/verify/body-validate failure must drop.

3) **Body schema too permissive**
   - If we allow arbitrary strings/unknown fields, contact exchange leaks become likely.

4) **event_hash instability**
   - Must use JCS + SHA-256 exactly; any deviation breaks audit reproducibility.

5) **SessionApplyResult drift**
   - If different paths return different shapes, storage/audit wiring will become error-prone.

6) **Accidental leakage in preview_safe**
   - preview_safe must never contain text; only metadata/hashes/lengths.
