# EXECUTION_RUNTIME_LAYER_FROZEN.md

Status: **FROZEN** (minimal scope complete and locally proven)

This document defines the frozen, minimal **Execution Runtime Layer** scope.

---

## 1) Implemented components

The Execution Runtime Layer consists of exactly these minimal runtime primitives:

1. **capabilityHandlerRegistry**
   - `src/execution/capabilityHandlerRegistry.mjs`
   - Deterministic in-memory Map-backed registry (`{ _handlers: new Map() }`) for `capability_id -> handler`.

2. **invocationExecutor**
   - `src/execution/invocationExecutor.mjs`
   - Minimal deterministic handler dispatch over a validated invocation request.

3. **resultAdapter**
   - `src/execution/resultAdapter.mjs`
   - Adapts the raw executor output into the already-frozen Capability Invocation result primitive.

---

## 2) Proven runtime path

The following local runtime path is proven end-to-end on a single machine:

`capability_reference`
→ `capability_invocation_request`
→ `capabilityHandlerRegistry`
→ `registerCapabilityHandler`
→ `executeInvocation`
→ **raw execution result**
→ `adaptExecutionResult`
→ `capability_invocation_result`

Notes:
- The invocation request is produced using the frozen Capability Invocation request primitive.
- The invocation result is produced using the frozen Capability Invocation result primitive.

---

## 3) Proven gating rules

The Execution Runtime Layer enforces and preserves the following gating rules:

- **Execution is valid only through an invocation-ready capability reference**
  - Invocation requests must originate from a capability reference with `invocation_ready === true` (as enforced by the frozen request primitive).

- **Invocation remains bound to friendship_id / capability_id context**
  - Invocation request includes `friendship_id` and `capability_id` and the executor dispatch uses `capability_id` only.

- **Unknown capability_id fails closed**
  - If a handler is not registered for `capability_id`, execution does not proceed and fails closed.

- **Invalid invocation payload fails closed**
  - If invocation input (including payload) does not meet minimum validation / frozen primitive constraints, the path fails closed.

---

## 4) Proven outputs

The following outputs are proven machine-safe and deterministic within the frozen scope:

- **Machine-safe handler registry behavior**
  - Deterministic create/register/get semantics.
  - Unknown capability lookup returns deterministic `null`.

- **Machine-safe raw execution result**
  - Executor returns a fixed-shape object:
    - `{ invocation_id, executed, raw_result, error }`
  - On success: `executed:true`, `error:null`, `raw_result:<handler return>`.
  - On failure: `executed:false`, `raw_result:null`, `error:{code}`.

- **Machine-safe adapted capability_invocation_result**
  - Adapter returns the frozen Capability Invocation result primitive:
    - `{ invocation_id, ok, result, error, created_at }`
  - Success: `ok:true`, bounded `result` object, `error:null`.
  - Failure: `ok:false`, `result:null`, `error:{code}`.

---

## 5) Proven fail-closed behavior

The following fail-closed behaviors are proven:

- **Invalid invocation input fails closed**
  - Invalid invocation request inputs (including invalid payload) are rejected (fail closed).

- **Unknown handler fails closed with `HANDLER_NOT_FOUND`**
  - Executor returns `error:{code:'HANDLER_NOT_FOUND'}` and does not execute any handler.

- **Handler execution failure fails closed with `HANDLER_EXECUTION_FAILED`**
  - If handler throws, executor returns `error:{code:'HANDLER_EXECUTION_FAILED'}`.

- **Invalid raw result fails closed**
  - If `raw_result` is not a bounded machine-safe plain object required by the frozen invocation result primitive, adaptation fails closed.

- **No downstream orchestration/task artifacts are produced on fail-closed path**
  - No task/mailbox/marketplace/orchestration artifacts are created or emitted.

---

## 6) Explicitly NOT implemented

This frozen Execution Runtime Layer explicitly does **not** implement:

- Remote execution transport
- Distributed execution runtime
- Result transport/return path beyond local adaptation
- Mailbox
- Retry/backoff
- Orchestration
- Marketplace / pricing / scheduling

---

## 7) Hard separation boundaries

The following boundaries are hard and remain unchanged:

- Transport remains below protocol semantics
- Envelope semantics remain frozen
- Phase3 semantics remain unchanged
- Friendship Trigger semantics remain unchanged
- Discovery semantics remain unchanged
- Conversation semantics remain unchanged
- Capability Sharing semantics remain unchanged
- Capability Invocation semantics remain unchanged

Within this boundary:

- Execution Runtime **executes handlers and adapts results only**.
- Execution Runtime **does not introduce orchestration**.

---

## 8) Proof boundary

The following proof points are explicitly validated locally:

- Local Execution Runtime E2E validated
- invocation_request observed
- handler registration observed
- success execution path observed
- failure execution path observed
- unknown handler fail-closed observed
- invalid payload fail-closed observed
