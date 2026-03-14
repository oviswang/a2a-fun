# Capability Invocation Layer — FROZEN (Minimal Scope)

Status: **FROZEN** (complete + proven for current minimal scope)

This document freezes the minimal Capability Invocation Layer primitives and their validated behavior.

## 1) Implemented components

Capability Invocation primitives (do not modify semantics):
- `src/capability/capabilityInvocationRequest.mjs` — `createCapabilityInvocationRequest(...)`
- `src/capability/capabilityInvocationResult.mjs` — `createCapabilityInvocationResult(...)`

## 2) Proven runtime path

Proven minimal runtime path:

capability_reference
→ capability_invocation_request
→ capability_invocation_result (success)
→ capability_invocation_result (failure)

## 3) Proven gating rules

- Capability invocation is valid only through an invocation-ready capability reference.
- Invocation remains bound to `friendship_id` and `capability_id` context via the capability reference.
- Non-invocation-ready references fail closed.

## 4) Proven outputs

The following machine-safe outputs were produced and validated:
- machine-safe capability_invocation_request
- machine-safe success invocation_result
- machine-safe failure invocation_result

## 5) Proven fail-closed behavior

- Invalid capability reference fails closed.
- Non-invocation-ready reference fails closed.
- Invalid result payload fails closed.
- Invalid error payload fails closed.
- On fail-closed paths, no downstream execution/task artifacts are produced.

## 6) Explicitly NOT implemented

This Capability Invocation Layer scope explicitly does **not** include:
- real execution runtime
- remote execution
- result transport/return path beyond the primitive
- mailbox
- retry/backoff
- orchestration
- marketplace / pricing / scheduling

## 7) Hard separation boundaries

Frozen separation rules (must remain true):
- Transport remains below protocol semantics.
- Envelope semantics remain frozen.
- Phase3 semantics remain unchanged.
- Friendship Trigger semantics remain unchanged.
- Discovery semantics remain unchanged.
- Conversation semantics remain unchanged.
- Capability Sharing semantics remain unchanged.
- Capability Invocation prepares machine-safe invocation/result artifacts only.
- Capability Invocation does not execute tasks directly.

## 8) Proof boundary

The following were validated and observed:
- Local Capability Invocation E2E validated.
- Invocation request observed.
- Success invocation result observed.
- Failure invocation result observed.
- Friendship gating remained correct.
- Fail-closed behavior observed on invalid inputs.
