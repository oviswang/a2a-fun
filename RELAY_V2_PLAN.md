# RELAY_V2_PLAN.md

## 1. Purpose

Relay v2 is a next-phase relay service focused on **reliability and observability** while keeping all frozen protocol/runtime semantics unchanged.

Relay v2 is responsible for:
- Explicit node registration
- Stable routing between connected nodes
- Relay-side observability (what is registered, what was routed, what was dropped)
- Delivery acknowledgements (sender can tell whether relay forwarded vs dropped)
- Session-aware node mapping (avoid fragile nodeId collisions across concurrent clients)

Relay v2 is not an application protocol. It is a transport-adjacent forwarding service with machine-safe behavior.

## 2. Position in System

Relay v2 sits on the network path below runtime semantics:

node websocket client
→ relay registration
→ relay routing
→ relay delivery acknowledgment
→ target node receive

It must remain a transparent carrier of opaque runtime payloads.

## 3. Minimal Goal

Smallest successful Relay v2 outcome:
- `nodeA` registers visibly
- `nodeB` registers visibly
- Relay forwards messages from A → B
- Relay forwards messages from B → A
- Relay logs what happened (machine-safe trace)
- Sender receives a delivery acknowledgement

## 4. Required Concepts

Minimum concepts needed (wire-level / relay-level only):

- **node registration**
  - A first message that binds a connection to an identity.

- **node_id**
  - Stable logical identifier for routing.

- **session_id**
  - A caller-provided identifier that scopes a registration.
  - Used to prevent accidental overwrites when the same `node_id` has multiple concurrent connections.

- **trace_id**
  - A sender-provided identifier for correlating relay send → relay ack → receiver delivery.

- **routing table**
  - Relay-maintained mapping: `(node_id, session_id) -> connection`.
  - Must be inspectable (at least via logs; optionally via a read-only diagnostic endpoint).

- **relay delivery ack**
  - A machine-safe acknowledgement message emitted back to the sender:
    - forwarded vs dropped
    - reason code
    - timestamps

- **relay trace log**
  - Machine-safe, minimal event log for:
    - register
    - unregister
    - relay received
    - forwarded
    - dropped
    - ack sent

## 5. Minimal Runtime Path

Intended runtime path (conceptual):

client connect
→ register(node_id, session_id)
→ relay stores routing entry
→ relay receives relay message(trace_id, from, to, payload)
→ relay forwards to target
→ relay emits ack to sender
→ relay records trace

Key rule: payload remains opaque; relay never interprets protocol/envelope/capability semantics.

## 6. Minimal Implementation Order

1) Explicit registration model
- Introduce `(node_id, session_id)` registration and define fail-closed validation.

2) Routing table visibility
- Make routing state observable (structured logs; optional read-only snapshot).

3) Trace logging
- Add a minimal trace log per relay message and per drop.

4) Ack return
- Add deterministic ack events tied to `trace_id`.

5) Local E2E
- Validate A↔B multi-message forwarding and ack behavior locally.

6) Public relay E2E
- Validate the same across the public gateway path.

7) Freeze document
- Freeze Relay v2 wire shapes, validation rules, and observability guarantees.

## 7. Hard Constraints

Relay v2 must not modify:
- Frozen transport semantics
- Frozen envelope semantics
- Phase3 semantics
- Friendship Trigger semantics
- Discovery semantics
- Conversation semantics
- Capability Sharing semantics
- Capability Invocation semantics
- Execution Runtime semantics
- Remote Execution Runtime semantics

Additionally:
- Fail-closed behavior must remain
- Relay must not become an orchestration layer

## 8. Explicit Non-Goals

Relay v2 does NOT include (in this phase):
- Mailbox
- Retry queues
- Scheduling
- Orchestration
- Marketplace logic
- Durable persistence
- Distributed consensus

## 9. Success Criteria

Relay v2 is successful when:
- Node registration is visible (who is registered, under what `(node_id, session_id)`)
- Routing table is visible (at least via structured logs; ideally via read-only diagnostics)
- Message traces are visible (trace_id-based logging)
- Delivery acknowledgements work (sender receives forwarded/dropped outcome)
- Multi-message forwarding becomes diagnosable (no silent drops)
- Relay failures become observable (reason codes, drop causes)

## 10. Follow-up Phase

Successful completion enables:
- Stable public remote execution (bidirectional request/result delivery)
- Better network debugging and operator confidence
- Future relay hardening (rate limits, auth, optional persistence) without touching frozen protocol/runtime semantics
