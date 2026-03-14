# RELAY_V2_CLIENT_ADAPTER_PLAN.md

## 1. Purpose

The Relay v2 client/transport adapter is responsible for:
- Speaking the Relay v2 registration format (`{ node_id, session_id }`)
- Preserving the frozen transport/runtime semantics above it
- Enabling current remote execution harnesses and runtime flows to use Relay v2

This adapter is explicitly a **compatibility layer**. It must not introduce new protocol meaning.

## 2. Position in System

It sits below runtime callers and above the Relay v2 websocket server:

runtime / transport caller
→ relay client adapter
→ Relay v2 websocket server

Everything above the adapter (remote execution runtime primitives, invocation artifacts, etc.) remains unchanged.

## 3. Minimal Goal

Smallest successful outcome:
- Client connects to Relay v2
- Client registers with `{ node_id, session_id }`
- Client can send relay payloads
- Client can receive forwarded payloads
- Client can receive ack

## 4. Required Concepts

Minimum concepts required:

- **node_id**
  - Logical routing identifier used by existing runtime/harness code.

- **session_id**
  - A scoped identifier to prevent node registration overwrite issues.
  - Must be chosen deterministically or safely derived (e.g. a short random/uuid per process).

- **register message**
  - Relay v2 format:
    - `{ type: "register", node_id, session_id }`

- **relay message**
  - Existing relay payload flow remains opaque:
    - `{ type: "relay", to, payload, trace_id? }`

- **ack message**
  - Relay v2 server emits:
    - `{ type: "ack", trace_id, status, reason }`

- **compatibility layer**
  - Maps v1 caller intent (`nodeId`) into v2 registration fields (`node_id`, `session_id`).

## 5. Minimal Runtime Path

client connect
→ register(node_id, session_id)
→ send relay payload
→ receive forwarded payload
→ receive ack

Key requirement: payload remains opaque; the adapter does not interpret envelope/protocol/capability semantics.

## 6. Minimal Implementation Order

1) Relay v2 client registration primitive
- Add a minimal adapter function that sends `{ type:"register", node_id, session_id }`.

2) Relay v2 message receive handling
- Maintain the existing `onForward` behavior, but ensure it is compatible with v2 forwarded message shape.

3) Relay v2 ack handling
- Decide minimal ack handling policy:
  - optionally expose a callback (`onAck`) for observability
  - or ignore ack in baseline callers while still proving it is received

4) Local E2E
- Validate registration + send + receive + ack against a local Relay v2 server.

5) Public E2E
- Validate against the public bootstrap relay domain.

6) Freeze document
- Freeze the adapter behavior and compatibility guarantees.

## 7. Hard Constraints

- Do not modify frozen protocol semantics
- Do not modify execution semantics
- Do not modify remote execution semantics
- Keep changes adapter-only (transport-facing only)

## 8. Explicit Non-Goals

This phase does NOT include:
- Redesign of remote execution
- Mailbox
- Retry/backoff
- Orchestration
- Persistence
- Marketplace logic

## 9. Success Criteria

- Relay v2 registration works (node_id + session_id)
- Forwarded payloads work
- Ack is received
- Current remote execution harness can be adapted to Relay v2 via the adapter (without changing frozen runtime semantics)

## 10. Follow-up Phase

Successful completion enables:
- Full public Relay v2 remote execution E2E
- Relay v2 freeze
- More reliable public network execution via observability + session-aware registration
