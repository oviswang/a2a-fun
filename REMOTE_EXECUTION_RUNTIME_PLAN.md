# REMOTE_EXECUTION_RUNTIME_PLAN.md

## 1. Purpose

The **Remote Execution Runtime** is the next layer above the frozen local Execution Runtime.

Responsibilities (minimal scope):
- Send `invocation_request` from one node (caller) to another node (executor)
- Bind remote execution to **friendship-gated** `capability_reference` context
- Execute the referenced capability handler on the remote node (using frozen local Execution Runtime)
- Return a **machine-safe** `invocation_result` to the caller
- Remain strictly separate from orchestration / scheduling / marketplaces

## 2. Position in System

Remote Execution Runtime sits between frozen Capability Invocation artifacts and the network transport:

`capability_reference`
→ `invocation_request`
→ **remote execution runtime**
→ remote handler execution (local Execution Runtime on Node B)
→ `invocation_result` return
→ local receipt (Node A)

This layer must treat all inbound as hostile input and fail closed.

## 3. Minimal Goal

Smallest successful remote execution outcome:
- Node A has a valid `capability_reference`
- Node A creates `invocation_request`
- Node B receives the request
- Node B executes the referenced capability handler
- Node B returns a machine-safe `invocation_result`
- Node A receives the result

## 4. Required Concepts

Minimum concepts required to implement remote execution without changing frozen semantics:

- **Remote invocation transport mapping**
  - A way to send an `invocation_request` payload to a specific peer node using the already-frozen transport baseline (direct + relay).
  - This mapping is *routing-only*; it does not change transport semantics.

- **Remote execution entrypoint**
  - A dedicated runtime entrypoint on Node B that accepts a remote invocation request payload.
  - Must not reuse or mutate frozen protocol/envelope semantics.

- **Remote result return path**
  - A dedicated return message that carries a machine-safe `invocation_result` back to Node A.

- **Invocation correlation by `invocation_id`**
  - Node A must correlate returned results to the originating `invocation_request` using `invocation_id`.

- **Friendship-gated execution rule**
  - Remote execution must be rejected unless the invocation is in a friendship context consistent with the reference/request.
  - The minimal rule is: do not execute unless the request contains `friendship_id` and the executor can associate that friendship with the requesting peer.

- **Fail-closed remote error behavior**
  - Unknown handler, invalid request, or execution failure must return only a machine-safe `{ code }` error.
  - No raw stack traces, no internal handles.

## 5. Minimal Runtime Path

Intended path (minimal, relay-compatible):

**Node A (caller)**
1) Has `capability_reference`
2) Calls frozen `createCapabilityInvocationRequest(...)` → `invocation_request`
3) Remote Execution Runtime sends the request payload via frozen transport baseline:
   - direct HTTP when reachable, else relay

**Transport**
- Uses existing direct/relay transport behavior (forward JSON payload; no semantic changes)

**Node B (executor)**
4) Remote execution runtime entry receives `{ invocation_request, ...context }`
5) Applies strict validation + friendship gating
6) Uses frozen local Execution Runtime:
   - handler registry
   - `executeInvocation(...)` → raw execution result
   - `adaptExecutionResult(...)` → frozen `invocation_result`

**Return path**
7) Node B sends machine-safe `invocation_result` back to Node A via the same frozen transport baseline
8) Node A receives `invocation_result` and correlates by `invocation_id`

Important: the remote execution runtime must not require modifications to:
- transport baseline
- envelope semantics
- protocol runtime / Phase3

It may define new *runtime-level* message shapes as long as they are carried by the frozen transport as opaque JSON payloads.

## 6. Minimal Implementation Order

1) **Remote invocation transport primitive**
   - Minimal send helper that uses existing direct/relay transport to deliver an invocation payload to a peer node.

2) **Remote execution entry primitive**
   - Minimal inbound handler on Node B that validates + gates + runs frozen local Execution Runtime.

3) **Remote result return primitive**
   - Minimal return-message shape and send helper to deliver `invocation_result` back to Node A.

4) **Local two-process E2E**
   - Run Node A + Node B locally (two processes, different ports) and validate full remote invocation + return.

5) **Real two-machine relay E2E**
   - Validate the same path over the existing relay infrastructure.

6) **Freeze document**
   - Freeze Remote Execution Runtime minimal primitives + validated paths + fail-closed behaviors.

## 7. Hard Constraints

This phase must obey:
- Do not modify frozen transport semantics
- Do not modify frozen envelope semantics
- Do not modify Phase3 semantics
- Do not modify Friendship Trigger semantics
- Do not modify Discovery semantics
- Do not modify Conversation semantics
- Do not modify Capability Sharing semantics
- Do not modify Capability Invocation semantics
- Do not modify Execution Runtime semantics

Safety constraints:
- Fail-closed behavior must remain
- No mailbox
- No retry/backoff
- No broad runtime orchestration

## 8. Explicit Non-Goals

This phase does NOT include:
- Queueing
- Scheduling
- Orchestration
- Marketplace / pricing
- Batch invocation
- Multi-agent planning
- Distributed memory

## 9. Success Criteria

Remote Execution Runtime is considered successful when:
- An `invocation_request` can be sent from Node A to Node B
- Node B executes the correct handler (by `capability_id`) using frozen local Execution Runtime
- A machine-safe `invocation_result` is returned to Node A
- Invocation remains friendship-gated
- Invalid remote execution inputs fail closed (no unsafe leakage)

## 10. Follow-up Phase

Successful completion enables:
- True cross-node agent cooperation (real remote capability execution)
- Later orchestration layers (explicitly out of scope for this phase)
- Richer service networks (capability networks on top of friendship relationships)
