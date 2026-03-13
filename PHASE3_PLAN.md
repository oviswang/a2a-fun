# Phase 3 Plan (a2a.fun) — Planning Only

Date: 2026-03-13

Phase 2 is frozen. Phase 3 focuses on the **friendship write side-effect layer**.

Phase 3 MUST build on top of Phase 2 without modifying:
- SessionManager state transition behavior
- processInbound(...)
- processLocalEvent(...)
- protocolProcessor orchestration semantics
- Phase 2 validation / fail-closed rules

Any change to Phase 2 behavior requires explicit approval.

Hard rule:
- SessionManager only manages state transitions.
- protocolProcessor only orchestrates processing.
- SessionManager MUST NOT write friendship data.
- protocolProcessor MUST NOT write friendship data.

This document defines architecture/rules/storage format/trigger conditions only.
**DO NOT IMPLEMENT friendshipWriter yet.**

---

## 1) Trigger condition

Friendship write is triggered when:
- `state.state == MUTUAL_ENTRY_CONFIRMED`

The trigger is based on a state transition or detection of being in that state.

---

## 2) Idempotency rule

Friendship writes MUST be idempotent.
- Repeated triggers MUST NOT duplicate records.
- Re-processing the same session/state MUST be a no-op after the friendship is recorded.

Recommended idempotency key:
- `peer_actor_id` (unique key) OR
- composite: `(peer_actor_id, session_id)` depending on whether multiple sessions can establish the same friendship.

Phase 3 minimal approach:
- Unique on `peer_actor_id` (one friend record per peer).

---

## 3) Storage format (minimal)

Write to a local file:
- `friends.json`

Minimal record shape:
```json
{
  "peer_actor_id": "h:sha256:...",
  "peer_key_fpr": "sha256:...",
  "session_id": "...",
  "established_at": "2026-03-13T00:00:00Z"
}
```

Notes:
- `peer_key_fpr` may be null until handshake/peer key binding exists.
- Do NOT store raw handles or contact methods.

---

## 4) New module

- `src/phase3/friendship/friendshipWriter.mjs`

## 5) Responsibilities of friendshipWriter

Responsibilities:
- detect `MUTUAL_ENTRY_CONFIRMED`
- write friendship record to `friends.json`
- guarantee idempotency
- produce a **machine-safe audit event**

Audit requirements:
- Machine-safe event core (no text)
- Stable hash: `event_hash = SHA-256(UTF8(JCS(event_core)))`

---

## 6) Separation of concerns

- SessionManager MUST NOT write friendship data.
- protocolProcessor MUST NOT write friendship data.
- friendshipWriter is triggered by **state/result** (e.g. transition to MUTUAL_ENTRY_CONFIRMED), not embedded into protocol core.

Processor integration rule (Phase 3):
- protocolProcessor returns only `session_apply_result`.
- A higher layer (watcher / application service / runner) triggers friendshipWriter based on state transitions.

---

## 7) Minimal friendship record

Minimal record fields:
- `peer_actor_id`
- `peer_key_fpr` (nullable until handshake exists)
- `session_id`
- `established_at`

Example record:
```json
{
  "peer_actor_id": "h:sha256:...",
  "peer_key_fpr": "sha256:...",
  "session_id": "s1",
  "established_at": "2026-03-13T00:00:00Z"
}
```

---

## 8) Failure rules

- Friendship write failure MUST NOT corrupt session state.
- Friendship side-effect failures MUST be isolated from the protocol state machine.
- On write failure: surface via audit_event and retry policy (if any) must live outside protocol core.

---

## Phase 3 work plan (planning only)

Planning-only milestones:
1) Define watcher trigger point (where to observe state transitions)
2) Define friends.json read/modify/write rules and locking strategy (single-process assumption first)
3) Define idempotency key and conflict behavior
4) Define machine-safe audit_event core for friendship writes

Implementation begins only after review.
