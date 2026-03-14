# REMOTE_EXECUTION_HARNESS_V2_MIGRATION_PLAN.md

## 1. Purpose

This migration phase is responsible for:
- Using **Relay v2 registration mode** in the existing remote execution two-machine harness.
- Preserving current **Remote Execution Runtime** semantics (opaque payload, fail-closed, deterministic machine-safe results).
- Enabling **public observability** during remote execution tests via Relay v2: `/nodes`, `/traces`, and delivery `ack`.

## 2. Position in System

The harness is an integration test driver that sits above the runtime layers:

Machine A / Machine B harness
→ Relay v2 client (registration + receive)
→ Relay v2 server (routing + `/nodes` + `/traces` + `ack`)
→ Remote Execution Runtime primitives (invocation transport + execution entry + result return)

The harness must remain a thin orchestrator: it wires together existing primitives and only adds logging / sequencing.

## 3. Minimal Goal

Smallest successful outcome (no redesign):
- Machine A connects via Relay v2 and registers successfully.
- Machine B connects via Relay v2 and registers successfully.
- Machine A sends `REMOTE_INVOCATION_REQUEST` (opaque runtime payload).
- Machine B receives, validates friendship gating, and executes locally.
- Machine B sends `REMOTE_INVOCATION_RESULT`.
- Machine A receives and matches the result by `invocation_id`.
- Relay v2 `/nodes`, `/traces`, and `ack` make the flow observable end-to-end.

## 4. Required Concepts

### Relay v2 registration mode
- Client uses `registrationMode: 'v2'`.
- Client sends a register message with explicit identifiers.

### node_id
- Stable identifier used by Relay v2 routing table.
- In harness: keep existing names (`nodeA`, `nodeB`) and preserve the existing anti-overwrite trick if still needed for Relay v1 compatibility (`nodeA-tx`), but prefer a single node identity per socket in Relay v2.

### session_id
- Relay v2 registration is **session-aware**.
- For harness determinism, assign explicit session ids:
  - Machine A session: `sa`
  - Machine B session: `sb`
- Session id must be stable for the life of a single harness run.

### forwarded payload handling
- Forwarded frames must continue to surface exactly as:
  - `onForward({ from, payload })`
- The harness must treat `payload` as opaque and pass it directly to the frozen runtime handlers.

### ack handling
- Relay v2 server sends `type:'ack'` frames to the sender socket.
- Client optionally consumes ack via `onAck(msg)`.
- Ack is transport-level observability only; it must not affect runtime semantics.

### trace observability
- Relay v2 server emits bounded trace events retrievable via `GET /traces`.
- During a harness run, traces should allow a human to answer:
  - Were both nodes registered?
  - Did Relay attempt to forward the request/result?
  - Was the forward acknowledged as `forwarded` or dropped?

## 5. Minimal Runtime Path

The minimal path (A→B request, B→A result) is:

1) Machine A connect/register
- Connect WebSocket to Relay v2 endpoint.
- Register with `{ node_id: 'nodeA', session_id: 'sa' }`.

2) Machine B connect/register
- Connect WebSocket to Relay v2 endpoint.
- Register with `{ node_id: 'nodeB', session_id: 'sb' }`.

3) Request send (Machine A)
- Use the frozen remote invocation transport primitive to send the opaque runtime payload.
- Transport uses relay client send path with `relayTo: 'nodeB'` (explicit).

4) Relay forward (server)
- Relay routes to the registered socket for `nodeB`.
- Relay emits:
  - `/traces` events for forward attempt/outcome
  - `ack` back to Machine A sender socket

5) Node B execute (Machine B)
- Machine B receives forwarded payload via `onForward`.
- Harness calls frozen `handleRemoteInvocation(...)`.
- Execution occurs via frozen local execution (`executeInvocation(...)` + result adapter).

6) Result send (Machine B)
- Harness calls frozen `sendRemoteInvocationResult(...)` (opaque result envelope).
- Transport uses relay client send path with `relayTo: 'nodeA'`.

7) Relay forward (server)
- Relay routes to registered socket for `nodeA`.
- Relay emits `/traces` + sender-socket `ack`.

8) Node A receive (Machine A)
- Machine A receives forwarded payload via `onForward`.
- Harness calls frozen `handleRemoteInvocationResult(...)` and correlates `invocation_id`.
- Deterministic timeout/wait loop remains harness-level only.

## 6. Minimal Implementation Order

1) Migrate Machine A client usage to Relay v2 mode
- Update harness to instantiate relay client with:
  - `registrationMode: 'v2'`
  - `nodeId: 'nodeA'`
  - `sessionId: 'sa'`
- Keep `onForward` wiring unchanged.

2) Migrate Machine B client usage to Relay v2 mode
- Update harness to instantiate relay client with:
  - `registrationMode: 'v2'`
  - `nodeId: 'nodeB'`
  - `sessionId: 'sb'`

3) Optionally surface ack logs in harness
- Provide `onAck` callback that logs ack frames with enough context:
  - `status`, `reason`, `trace_id`
- Do not gate behavior on ack; log only.

4) Local Relay v2 E2E
- Run the harness against a local Relay v2 server instance.
- Verify:
  - Both nodes appear in `/nodes` during the run.
  - `/traces` shows both forward directions.
  - Machine A receives results within timeout.

5) Public Relay v2 E2E
- Run the harness against the public relay endpoint.
- Verify the same observability outputs (`/nodes`, `/traces`, ack).

6) Freeze document
- Once the migration is validated, freeze this plan as the reference for the completed phase.

## 7. Hard Constraints

- Do not modify frozen protocol runtime semantics.
- Do not modify Execution Runtime Layer semantics.
- Do not modify Remote Execution Runtime semantics or primitives.
- Do not modify Relay v2 server semantics already implemented.
- Do not modify Relay v2 client semantics already implemented.
- Keep changes **harness-only** (scripts/runbook/tests) or **adapter-level usage** (configuration/wiring), not behavior.

## 8. Explicit Non-Goals

This phase does NOT include:
- Redesign of remote execution.
- Mailbox/queueing.
- Retry/backoff.
- Orchestration/scheduling.
- Persistence.
- Marketplace logic.
- Any changes to friendship/discovery/protocol interpretation.

## 9. Success Criteria

Migration is successful when:
- Relay v2 harness migration works (both machines connect/register using v2).
- Request path works (A→B invocation request delivered, executed).
- Result return path works (B→A invocation result delivered, correlated).
- Relay v2 observability confirms the path:
  - `/nodes` shows registered nodes with expected session ids
  - `/traces` contains forward + ack events for request and result
  - `ack` frames visible on sender sockets (logged, not required for correctness)
- Public remote execution becomes diagnosable and repeatable (failures are explainable via `/traces` + ack statuses).

## 10. Follow-up Phase

After this migration succeeds, it enables:
- Relay v2-based public remote execution validation (repeatable E2E runs).
- Relay v2 freeze (interface stability for Alpha).
- More reliable Alpha network execution by making failures observable and actionable without changing runtime semantics.
