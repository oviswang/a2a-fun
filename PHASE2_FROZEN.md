# Phase 2 Frozen Record (a2a.fun)

Frozen on: 2026-03-13 (Asia/Shanghai)

Phase 2 is **FROZEN**.
Behavior must remain stable unless fixing a **critical bug**.

## 1) Implemented components

- `processInbound(...)`
  - Remote protocol message processing entry
  - Strict order: envelope validate → verify → decrypt → body-validate → session-apply → audit-bind
  - Fail-closed: any failure throws and short-circuits; no audit_records produced

- `processLocalEvent(...)`
  - Local system/UI event processing entry
  - Chain: sessionManager.applyLocalEvent → audit-bind (1:1)
  - Fail-closed: any failure throws; no audit_records produced

- `applyLocalEvent(...)`
  - SessionManager local event entry
  - Supports Phase 2 local events only: `local.human.entry`, `local.session.close`
  - Enforces allowlist gate + terminal rule

- Local event injection (Phase 2)
  - `local.human.entry` and `local.session.close`
  - `local.human.entry` idempotent when `local_entered` already true (no repeated flags_delta; still emits LOCAL_EVENT audit)

- Local event audit binding
  - 1:1 binding of `session_apply_result.audit_events[]` into `audit_records[]`
  - preview_safe metadata-only (no text)

- Local event fail-closed handling
  - Any failure in local event apply/bind throws and produces NO audit_records

- SessionManager state machine (Phase 2 minimal)
  - States: DISCONNECTED, PROBING, PROBE_COMPLETE, AWAIT_ENTRY, MUTUAL_ENTRY_CONFIRMED, CLOSED, FAILED
  - Allowlist gate: `ALLOWED_TRANSITIONS_PHASE2`
  - Terminal rule: CLOSED/FAILED reject all
  - `human.entry` idempotent under AWAIT_ENTRY
  - `error` does not change state but emits audit_event

- Ed25519 sign / verify
  - Signature input fixed: `UTF8(JCS(envelope_without_sig))`
  - Fail-closed verifier errors: missing sig / sig not base64 / bad signature / missing peer public key

- Envelope validation
  - Plaintext schema checks + defense-in-depth plaintext lint
  - Plaintext lint MUST NOT replace schema validation

- Body schema validation
  - Supported vs reserved type gating
  - Machine-safe `error` body (no free-text)
  - Safe short text policy for summary/question/answer
  - `probe.hello` structured constraints + support allowlists (protocols/transports)

- protocolProcessor orchestration
  - DI-based orchestration only; no policy/strategy/retry/transport logic
  - Fixed output shapes:
    - inbound: `{ session_apply_result, audit_records, decrypted_body? }`
    - local: `{ session_apply_result, audit_records, local_event? }`

- audit_event core + audit binding
  - Minimal audit_event core fields: kind/session_id/msg_id/type/prev_state/next_state/flags_delta
  - Hard hash rule: `event_hash = SHA-256(UTF8(JCS(event_core)))`
  - preview_safe metadata-only (no text)

- fail-closed processor pipeline
  - Verified by tests: verify/decrypt/bodyValidate/sessionApply failures short-circuit and produce no audit_records

- local event injection
  - Phase 2 local events implemented:
    - `local.human.entry`
    - `local.session.close`
  - Enforces allowlist gate + terminal rule + machine-safe close reasons

## 2) Explicitly NOT implemented in Phase 2

- transport layer
- handshake protocol
- peer key discovery / binding
- probe engine strategy (round policy/timeout/summary generation)
- friendship graph write
- friendship persistence / writing friends.json
- friendship side-effects
- SessionManager and protocolProcessor MUST NOT write friendships
- network runtime
- retry / fallback / routing logic

## 3) Minimal happy path

Documented protocol success path:

DISCONNECTED
→ `probe.hello`
→ PROBING
→ `probe.summary` / `probe.done`
→ PROBE_COMPLETE
→ `local.human.entry`
→ AWAIT_ENTRY
→ remote `human.entry`
→ MUTUAL_ENTRY_CONFIRMED

Current minimal local/combined happy path:

PROBE_COMPLETE
→ `local.human.entry`
→ AWAIT_ENTRY
→ remote `human.entry`
→ MUTUAL_ENTRY_CONFIRMED

## 4) Processor entry rules

- `processInbound(...)` handles **remote protocol messages only**.
- `processLocalEvent(...)` handles **local UI/system events only**.

These two entry points MUST remain separate.
Local events MUST NOT be encoded or treated as remote protocol messages.
