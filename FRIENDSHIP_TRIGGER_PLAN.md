# Friendship Trigger / Watcher Layer Plan (a2a.fun) — Planning Only

Date: 2026-03-13

Phases 1, 2, 3 are frozen. This document defines a post-Phase-3 trigger/watcher layer.
**Do NOT implement yet.**

---

## 1) Purpose

This layer:
- Detects when a session reaches `MUTUAL_ENTRY_CONFIRMED`
- Decides when to call `friendshipWriter.writeFriendshipIfNeeded(...)`
- Lives **outside** SessionManager and protocolProcessor core logic

In other words: it is the glue between **Phase 2 state results** and **Phase 3 side-effect persistence**.

---

## 2) Separation of concerns (hard architecture boundaries)

- SessionManager: state transitions only
- protocolProcessor: protocol processing orchestration only
- friendshipWriter: side-effect persistence only
- Trigger/Watcher layer: connects state result → side-effect invocation

No component is allowed to “reach across” these boundaries.

---

## 3) Candidate integration models

### Model A — Upper-layer watcher consumes `session_apply_result`

Mechanism:
- Application code calls `protocolProcessor.processInbound(...)` / `processLocalEvent(...)`
- Receives `{ session_apply_result, ... }`
- Watcher evaluates `session_apply_result.next_state.state`
- If `MUTUAL_ENTRY_CONFIRMED`, calls `writeFriendshipIfNeeded(...)`

Pros:
- Minimal coupling: uses existing return value; no Phase 2 changes
- Deterministic: triggered exactly at the moment the state transition is observed
- Easy to isolate failures: `friendshipWriter` errors can be caught outside protocol core

Cons:
- Requires the application integrator to consistently run the watcher after every processing call


### Model B — Processor returns a side-effect hint (but does not perform side-effect)

Mechanism:
- protocolProcessor returns `session_apply_result` plus a machine-safe hint like:
  - `side_effects: [{ kind: 'FRIENDSHIP_WRITE', when: 'NOW' }]`
- Upper layer consumes this hint and triggers friendshipWriter

Pros:
- Explicit: makes required side-effects visible without embedding them
- Can improve observability

Cons:
- Would require changing protocolProcessor return shape and/or behavior
- This is a Phase 2 behavior change and is therefore **not allowed** under frozen constraints

Conclusion: Not eligible while Phase 2 is frozen.


### Model C — External watcher scans state/storage periodically

Mechanism:
- A background job periodically scans session storage for sessions in `MUTUAL_ENTRY_CONFIRMED`
- For each, calls `writeFriendshipIfNeeded(...)`

Pros:
- Decoupled from request path; tolerant to missed triggers
- Suitable for eventual consistency

Cons:
- Requires durable session storage + indexing, plus scanning strategy
- Requires defining exactly-once vs at-least-once semantics
- Can introduce delayed writes and additional complexity (scheduling, locking)

---

## 4) Recommended model

Recommend **Model A**.

Why:
- Fully compatible with frozen Phase 2/3: no changes to SessionManager/protocolProcessor needed
- Minimal surface area: a small function that consumes `session_apply_result` is sufficient
- Preserves failure isolation naturally (catch errors outside protocol core)
- Preserves idempotency: friendshipWriter already guarantees idempotency on `peer_actor_id`

---

## 5) Hard rules

- MUST NOT modify Phase 2 state transition behavior
- MUST NOT make protocolProcessor write friendships directly
- MUST preserve idempotency (repeat triggers must not duplicate)
- MUST preserve failure isolation
- Friendship write failure MUST NOT corrupt protocol state

---

## 6) Trigger condition

Trigger only when:
- `session_apply_result.next_state.state === 'MUTUAL_ENTRY_CONFIRMED'`

Notes:
- Do NOT trigger on `current_state` alone (avoid firing before transition is confirmed)
- Trigger should be evaluated after a successful processing call that produced a `session_apply_result`

---

## 7) Audit behavior

Two distinct audits may exist:

1) Friendship write audit (already Phase 3)
- Produced by friendshipWriter on successful write
- Machine-safe, local-only, MUST NOT be transmitted outbound

2) Trigger execution audit (optional)
- If implemented, must be machine-safe and local-only
- It should log that the watcher attempted/decided to invoke friendshipWriter, without leaking handles

Recommendation (minimal):
- Do not add trigger audit initially; rely on friendship write audit + existing protocol/session audits.
- Add trigger audit later only if operational debugging requires it.

---

## 8) Failure behavior

If `friendshipWriter` throws:
- Catch at watcher boundary
- Do NOT affect protocol/session processing result
- Do NOT mutate SessionManager state

Retry policy:
- Explicitly **out of scope** for the first minimal watcher
- If needed later, implement retry/backoff in the watcher layer (never in protocol core)

---

## 9) Minimal implementation candidate (for Phase 4)

Smallest safe mechanism worth implementing first:
- A pure function (or small module) like:
  - `maybeTriggerFriendshipWrite({ session_apply_result, peer_actor_id, peer_key_fpr, session_id, storage, auditBinder })`
- Called by application code immediately after each successful `processInbound/processLocalEvent`

Key properties:
- At-most-once per call; overall semantics become at-least-once across repeated calls
- Idempotency is guaranteed by friendshipWriter
- Failure isolation: watcher catches and logs errors; returns protocol output unchanged
