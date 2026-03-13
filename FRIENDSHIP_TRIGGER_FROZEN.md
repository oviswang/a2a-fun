# Friendship Trigger Layer Frozen Record (a2a.fun)

Frozen on: 2026-03-13 (Asia/Shanghai)

Friendship trigger/watcher layer (minimal) is **FROZEN**.
Behavior must remain stable unless fixing a **critical bug**.

## 1) Implemented components

- `triggerFriendshipWriteIfNeeded(...)`
  - Module: `src/phase3/friendship/friendshipTrigger.mjs`
  - Purpose: bridge `session_apply_result.next_state` → `friendshipWriter.writeFriendshipIfNeeded(...)`
  - Trigger condition: only when `session_apply_result.next_state.state === 'MUTUAL_ENTRY_CONFIRMED'`

- Trigger result contract (machine-safe)
  - `NO_TRIGGER` (no writer call)
  - `TRIGGERED_WRITE` (writer called and wrote friendship)
  - `TRIGGERED_IDEMPOTENT` (writer called and idempotently skipped)

- Trigger-to-writer bridge
  - Trigger layer calls friendshipWriter only when the condition is met
  - Trigger layer preserves friendshipWriter idempotency (does not implement its own retry/backoff)
  - Trigger layer does not mutate protocol state

- Fail-closed input validation
  - Missing `session_apply_result` → throw
  - Missing `session_apply_result.next_state` → throw
  - Missing `friendshipWriter.writeFriendshipIfNeeded` → throw

## 2) Explicitly NOT implemented

- trigger-level audit
- retry/backoff
- external cron/scanner watcher
- exactly-once semantics
- distributed trigger runtime

## 3) Hard separation rules

- Trigger layer MUST NOT modify SessionManager
- Trigger layer MUST NOT modify protocolProcessor
- Trigger layer MUST NOT write friendship data except through friendshipWriter
- Trigger layer MUST NOT introduce protocol behavior

## 4) Trigger result contract

- `NO_TRIGGER`
- `TRIGGERED_WRITE`
- `TRIGGERED_IDEMPOTENT`
- throw on invalid input or writer failure
