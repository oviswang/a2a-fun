# Capability Sharing Layer — Plan (on top of frozen Friendship + Conversation)

Status: **PLAN (documentation-only)**

This document defines the next implementation phase for the **Capability Sharing Layer** on top of the frozen:
- Friendship Trigger Layer (friendship establishment + machine-safe `friendship_record`)
- Conversation Runtime Layer (bounded conversation artifacts + handoff wiring)

No frozen transport/protocol/Phase3/Friendship/Discovery/Conversation semantics may be changed by this phase.

## 1) Purpose

Capability Sharing Layer is responsible for:
- Representing what an agent can do in a **machine-safe** way.
- Advertising capabilities to **friends only** (friendship-gated access).
- Allowing deterministic capability discovery between friends.
- Preparing the input boundary for later capability invocation.
- Remaining separate from task/result execution in this phase (no invocation side-effects yet).

## 2) Position in System

This layer sits after friendship establishment and before any invocation/exchange layers:

friendship established
→ capability sharing layer
→ capability discovery between friends
→ capability invocation layer (later)
→ task/result exchange (later)

## 3) Minimal Goal

The smallest successful capability-sharing outcome is:
- After friendship is established, an agent can create a machine-safe **capability advertisement**.
- Another friend can discover the **existence** of that capability.
- The system can produce a machine-safe **capability reference** suitable for later invocation.
- No task execution occurs yet.

## 4) Required Concepts

### 4.1 Capability advertisement
A machine-safe object describing a capability.

Key requirements:
- deterministic shape
- bounded fields
- no free-form long text

### 4.2 Capability identifier
A deterministic identifier for referencing a capability.

Example:
- `capability_id = cap:sha256:<hash>`

### 4.3 Capability description (bounded, machine-safe)
A small allowlisted structure describing:
- name
- short summary
- inputs schema reference (not full schema expansion initially)
- outputs schema reference

### 4.4 Capability discovery result
A machine-safe result describing which capabilities are discoverable for a given friend context.

### 4.5 Invocation-ready capability reference
A machine-safe reference that includes:
- `friendship_id` / peer identity binding
- `capability_id`
- bounded invocation metadata (no execution)

### 4.6 Friendship-gated access rule
Capability sharing/discovery must be allowed only when a valid `friendship_record` exists.

## 5) Minimal Runtime Path

Intended minimal runtime path (no frozen changes):

friendship_record
→ capability advertisement
→ capability discovery
→ capability reference
→ later invocation path

Notes:
- The discovery result must be deterministic and bounded.
- This phase produces references only; it does not execute.

## 6) Minimal Implementation Order

1. Capability advertisement primitive
2. Capability discovery primitive
3. Invocation-ready capability reference primitive
4. Local E2E
5. Two-machine relay E2E
6. Freeze document

## 7) Hard Constraints

This phase must obey:
- Do not modify frozen transport semantics.
- Do not modify frozen envelope semantics.
- Do not modify Phase3 semantics.
- Do not modify Friendship Trigger semantics.
- Do not modify Discovery semantics.
- Do not modify Conversation semantics.
- Fail-closed behavior must remain (invalid input → machine-safe error; no partial artifacts).
- No task execution yet.
- No task result exchange yet.
- No mailbox.
- No broad runtime orchestration.

## 8) Explicit Non-Goals

This phase explicitly does **not** include:
- full capability invocation
- task execution
- task result exchange
- mailbox
- queue / retry / backoff
- market / economy logic
- capability ranking marketplace
- broader permission economy

## 9) Success Criteria

This phase is successful when:
- A machine-safe capability advertisement exists.
- Capability discovery works only in a friendship-gated context.
- An invocation-ready capability reference can be produced.
- Invalid capability inputs fail closed.
- No task execution side-effects occur.

## 10) Follow-up Phase

Successful completion of this phase enables:
- capability invocation
- result return path
- later agent cooperation phases
