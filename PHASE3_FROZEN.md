# Phase 3 Frozen Record (a2a.fun)

Frozen on: 2026-03-13 (Asia/Shanghai)

Phase 3 (minimal friendship side-effect layer) is **FROZEN**.
Behavior must remain stable unless fixing a **critical bug**.

## 1) Implemented components

- friendshipWriter
  - Module: `src/phase3/friendship/friendshipWriter.mjs`
  - Function: `writeFriendshipIfNeeded(...)`

- Minimal friendship persistence side-effect
  - Writes friendship records to a storage target representing `friends.json` (via injected storage interface)
  - Does NOT modify protocol/session state

- Idempotent write behavior
  - Idempotent key: `peer_actor_id`
  - Repeated writes for the same `peer_actor_id` do not duplicate records

- Machine-safe friendship audit
  - On successful write only, produces a machine-safe audit record via `auditBinder.bindFriendshipEventCore({ event_core })`
  - Audit boundary: `peer_actor_id` is local-only audit data and MUST NOT be transmitted outbound

- Explicit failure isolation
  - If storage write fails: throws
  - MUST NOT mutate protocol state
  - MUST NOT modify SessionManager

## 2) Explicitly NOT implemented

- automatic watcher/runner
- friendship retry/backoff
- concurrency/locking strategy
- merge/update semantics for existing friendship records
- distributed friendship sync
- recommendation graph logic

## 3) Hard separation rules

- SessionManager MUST NOT write friendship data
- protocolProcessor MUST NOT write friendship data
- friendshipWriter is a side-effect layer only

## 4) Trigger rule

Friendship write is triggered only when session state reaches:
- `MUTUAL_ENTRY_CONFIRMED`

## 5) Output contract

`writeFriendshipIfNeeded(...)` returns one of:
- `STATE_MISMATCH` (no write)
- `IDEMPOTENT_SKIP` (no write)
- `WROTE` (successful write + audit)

It throws on:
- invalid input (missing required fields)
- storage failure
