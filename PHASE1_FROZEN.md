# Phase 1 Frozen Record (a2a.fun)

Frozen on: 2026-03-13 (Asia/Shanghai)

## Freeze scope
Phase 1 is **frozen** and includes only:
- **identity** (canonicalization → `actor_id`, local identity key store, key fingerprint, outbound no-raw-handle lint, IdentityService façade)
- **storage** (Phase 1 JSON storage implementation and schemas: friends/sessions/audit_logs)
- **profile extractor** (probe-safe profile extraction + sanitize + input allowlists + output whitelists)

## Policy
Phase 1 (identity / storage / profile extractor) is frozen.
**Subsequent work MUST NOT modify Phase 1 behavior unless explicitly approved.**

Bugfix-only changes are allowed **only** with explicit approval and must:
- preserve spec constraints (no raw handle, peer fail-closed, output whitelist)
- add regression tests

---

## Frozen checklist

### Spec / constraints
- [x] `spec/v0.4.3.md` marked **FROZEN**.
- [x] `probe_transcript_hash.ciphertext_len` uses **decoded ciphertext byte length**.
- [x] canonical string uses version tag: `a2a:v1:<provider>:<normalized_account>`.
- [x] `actor_id` vectors include a UTF-8 canonicalization test vector.

### Identity
- [x] `IdentityService.deriveActorId()` default returns **only** `{ actor_id, provider }`.
- [x] `normalized_account` and `canon` treated as sensitive local data; returned only via `includeSensitive:true`.
- [x] `makeAgentLabel()` defaults to `"Local Agent"`, is short, probe-safe, and MUST pass outbound lint.
- [x] `OutboundLint.assertNoRawHandle()` is recursive and checks keys + values across string/object/array.
- [x] peer contact markers are detected (email/E.164/@handle/messenger markers/wa.me).

### ProfileExtractor
- [x] input-side allowlists are constants (local/peer).
- [x] output whitelists are constants (local/peer) and enforced with stable key order.
- [x] peerBody is treated as hostile input: **lint first, fail closed**.
- [x] localContext strict lint is optional toggle (`strictLocalProfileLint`), default false.
- [x] redaction_report structure is stable (`dropped_fields` sorted, `notes` fixed).

### Storage
- [x] FriendRecord has **no friend_id**; friends keyed by `peer_actor_id`.
- [x] `peer_key_fpr` is nullable in Phase 1.

### Tests
- [x] `npm test` passes.
- [x] tests cover: actor_id vectors, outbound lint recursion, peer hostile inputs, output stability, strictLocalProfileLint toggle.

---

## Explicit non-goals (NOT in Phase 1)
- transport / P2P connection establishment
- handshake / peer key binding / filling `peer_key_fpr`
- probe engine full flow
- session full lifecycle orchestration
- signing/verification implementation for envelopes
- sqlite migration

---

## Preconditions to enter Phase 2
Phase 2 work may proceed if:
- Phase 1 remains unchanged by default (no behavioral edits without approval).
- Phase 2 is introduced via **new modules/files** (or strictly additive interfaces) with separate tests.
- Each Phase 2 module has:
  - a clear interface boundary
  - explicit threat model assumptions
  - fail-closed behavior where applicable (especially verification)
