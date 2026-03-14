# Capability Invocation Layer — Plan (on top of frozen Capability Sharing)

Status: **PLAN (documentation-only)**

This document defines the next implementation phase for the **Capability Invocation Layer** on top of the frozen **Capability Sharing Layer** (advertisement → discovery → invocation-ready capability reference).

No frozen transport/protocol/Phase3/Friendship/Discovery/Conversation/CapabilitySharing semantics may be changed by this phase.

## 1) Purpose

Capability Invocation Layer is responsible for:
- Representing a machine-safe **invocation request**.
- Binding invocation to a friendship-gated **capability reference**.
- Preparing the runtime boundary for remote execution (without adding broad orchestration).
- Preparing a machine-safe **result return** shape.
- Remaining separate from richer task orchestration in this phase.

## 2) Position in System

This layer sits after capability references exist:

friendship established
→ capability sharing
→ capability reference
→ capability invocation layer
→ result return layer
→ later task cooperation

## 3) Minimal Goal

The smallest successful capability-invocation outcome is:
- After a capability reference exists, the system can create a machine-safe **invocation request**.
- The request can be prepared for runtime/protocol transport (without changing frozen protocol semantics).
- A machine-safe **invocation result** shape can be defined for later return.
- No broad orchestration occurs yet.

## 4) Required Concepts

### 4.1 Invocation request
A machine-safe object describing what to execute.

Requirements:
- deterministic shape
- bounded fields
- explicit binding to capability reference

### 4.2 Invocation identifier
A deterministic identifier for tracking the invocation lifecycle.

Example:
- `invocation_id = inv:sha256:<hash>`

### 4.3 Capability reference binding
Invocation must bind to:
- `capability_ref_id`
- `friendship_id`
- `capability_id`

This ensures friendship-gated execution context.

### 4.4 Invocation input payload (bounded, machine-safe)
A small bounded payload describing invocation parameters.

Constraints:
- no arbitrary code
- no free-form long text
- deterministic serialization

### 4.5 Invocation result shape
A machine-safe result object shape (no transport coupling).

Example fields:
- `invocation_id`
- `ok` boolean
- `result` (bounded, allowlisted shape)
- `error` (machine-safe code)

### 4.6 Friendship-gated execution rule
Execution is permitted only when:
- the capability reference is bound to an established friendship context
- friendship gating is enforced (no cross-friend invocation)

## 5) Minimal Runtime Path

Intended minimal runtime path (no frozen changes):

capability_reference
→ invocation request
→ runtime/protocol transport
→ remote execution boundary
→ machine-safe result return

Notes:
- This phase may prepare request payloads for sending, but must not change frozen transport/protocol semantics.
- Remote execution boundary should be explicit: “request prepared” vs “executed” is separate.

## 6) Minimal Implementation Order

1. Capability invocation request primitive
2. Invocation result primitive
3. Local E2E
4. Two-machine relay E2E
5. Freeze document

## 7) Hard Constraints

This phase must obey:
- Do not modify frozen transport semantics.
- Do not modify frozen envelope semantics.
- Do not modify Phase3 semantics.
- Do not modify Friendship Trigger semantics.
- Do not modify Discovery semantics.
- Do not modify Conversation semantics.
- Do not modify Capability Sharing semantics.
- Fail-closed behavior must remain (invalid input → machine-safe error; no partial artifacts).
- No mailbox.
- No retry/backoff.
- No broad runtime orchestration.

## 8) Explicit Non-Goals

This phase explicitly does **not** include:
- marketplace / pricing
- scheduling
- queueing
- batch orchestration
- multi-agent planning
- memory economy
- broader permission economy

## 9) Success Criteria

This phase is successful when:
- A machine-safe invocation request exists.
- Invocation remains friendship-gated.
- A machine-safe result shape exists.
- Invalid invocation inputs fail closed.
- No broad orchestration side-effects occur.

## 10) Follow-up Phase

Successful completion of this phase enables:
- result return path
- later cooperative agent task execution
