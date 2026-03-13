# Phase 2 Status (a2a.fun)

Date: 2026-03-13

Phase 1 (identity / storage / profile extractor) is frozen. Phase 2 focuses on envelope/signature/body-validate/session/audit + minimal protocol processor orchestration.

## 1) Current capabilities (implemented)

### Protocol primitives
- Envelope schema validator (fail closed)
- Canonicalization for signing input: JCS(envelope_without_sig) → UTF-8 bytes
- Real Ed25519 signing + verification (fail closed)
- Decrypted body schema validation (fail closed)
  - Includes strict machine-safe `error` body (no free-text)
  - Includes safe short text policy for `probe.summary.summary`, `probe.question.q`, `probe.answer.a`
  - Includes `probe.hello` structured constraints (protocols/transports/languages):
    - dedupe + stable sort
    - pattern constraints
    - support policy allowlists (protocols/transports) via Phase 2 constants

### SessionManager (minimal real state transitions)
- States: DISCONNECTED, PROBING, PROBE_COMPLETE, AWAIT_ENTRY, MUTUAL_ENTRY_CONFIRMED, CLOSED, FAILED
- ALLOWED_TRANSITIONS_PHASE2 gate (fail closed) is enforced
- `human.entry` idempotent behavior under AWAIT_ENTRY
- `session.close` reason allowlist (machine-safe)
- `error` does not change state; must emit audit_event

### Audit
- Hard rule: event_hash = SHA-256(UTF8(JCS(event_core)))
- preview_safe is metadata-only (no text)
- Minimal audit binding: bind each session_apply_result.audit_events 1:1 into audit_records

### protocolProcessor (orchestrator only)
- A DI-based processor that performs:
  1) validateEnvelope
  2) resolve peer key + verify signature
  3) decrypt
  4) validate decrypted body
  5) SessionManager apply
  6) bind audit_events 1:1
- Output shape fixed:
  - { session_apply_result, audit_records[], decrypted_body? }
- Fail-closed semantics fixed by tests:
  - if verify/decrypt/bodyValidate/sessionApply fails → throw, short-circuit, and produce NO audit_records

## 2) Explicit non-goals (currently NOT done)
- No transport implementation / network interoperability
- No handshake / peer key binding / peer_key_fpr filling
- No probe engine (round limits, timeout policies, summary generation)
- No friendship write / friend graph mutation (Phase 2 stops at MUTUAL_ENTRY_CONFIRMED)
- No retry/fallback/orchestrator logic in processor
- No local event injection implemented (only discussed)

## 3) Current minimal happy path
- Input: DISCONNECTED session state + signed `probe.hello` envelope
- Decrypt returns minimal body: { protocols: ["a2a.friendship/1"] }
- Output: session transitions to PROBING, 1 audit_event bound into 1 audit_record

## 4) Next-step candidate directions (choose later)
- Local Event Injection design + implementation (local.human_entry / local.close / local.block etc)
- Key resolver strategy (still no handshake): local cache lookup + key rotation ceremony design
- Expand SessionManager transition coverage (still no probe engine): handle more message types strictly
- Tighten JCS canonicalization to full RFC8785 edge cases (numbers) if needed
- Processor integration tests for additional fail-closed paths and invariants
