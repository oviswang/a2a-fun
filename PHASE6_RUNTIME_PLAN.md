# Phase 6 Plan (a2a.fun) — Runtime / Transport Layer — Planning Only

Date: 2026-03-13

Phases 1–5 are frozen.
This document is Phase 6 planning only. **Do NOT implement yet.**

---

## 1) Purpose

Phase 6 defines how protocol messages move between agents:
- Receive inbound messages from some transport
- Feed them into the frozen protocol core (Phase 2)
- Send outbound messages produced by higher layers (Probe Engine / application)

The runtime is responsible for I/O and wiring; it must not change protocol semantics.

---

## 2) Minimal runtime model

Smallest possible runtime communication model (example):
- **HTTP POST JSON messages**
  - One endpoint for inbound messages
  - Outbound messages are sent via HTTP POST to a configured peer URL

Properties:
- No discovery (URLs are preconfigured/out-of-band)
- No distributed runtime
- No retries/backoff in the minimal node (fail closed, propagate errors)

---

## 3) Message ingress pipeline

Incoming message flow (strict layering; Phase 2 remains authoritative):

transport receive
→ (optional) minimal framing/size checks
→ protocolProcessor.processInbound(...) or protocolProcessor.processLocalEvent(...)
→ SessionManager state transitions (inside Phase 2)
→ (optional) ProbeEngine suggestion (Phase 4)
→ Trigger Layer (Phase 3.5)
→ FriendshipWriter (Phase 3)

Key rule:
- Transport layer must treat peer input as hostile and must not bypass Phase 2 validation.

---

## 4) Message egress pipeline

Outbound message flow:

ProbeEngine
→ (application chooses to send)
→ build message body (Phase 2 body schema constraints)
→ build envelope (Phase 2 envelope schema)
→ sign (Phase 2 signing rule)
→ encrypt (transport-specific; still out of scope for minimal HTTP JSON model unless explicitly added)
→ transport send

Key rule:
- Egress must run outbound lint / schema validation and must not leak raw handles.

---

## 5) Runtime components (minimal set)

Define the minimal runtime node components:

1) Transport adapter
- A module that can:
  - receive inbound messages (HTTP handler)
  - send outbound messages (HTTP client)

2) Message router
- Decides which handler to call:
  - inbound remote envelope → `processInbound`
  - local UI/system event → `processLocalEvent`

3) Session store
- Persists session state snapshots between messages
- Provides read/update primitives for the runtime driver

4) Runtime driver
- Orchestrates:
  - load current session state
  - invoke processor
  - persist updated state
  - invoke trigger/writer side-effects
  - return response/ack to transport

---

## 6) Explicitly NOT implemented

- distributed runtime
- discovery
- P2P mesh
- swarm coordination
- agent orchestration

---

## 7) Failure rules

- Transport failure must not corrupt protocol state
  - Never partially persist a state transition without audit/state consistency
  - If outbound send fails, do not pretend the peer received it

- Fail-closed behavior must be preserved
  - Invalid inbound must be rejected
  - Missing peer key / signature failure / decrypt failure must remain hard failures

- Side-effect failures must remain isolated
  - FriendshipWriter failures must not change SessionManager transitions (already enforced)

---

## 8) Minimal implementation candidate (smallest runnable runtime node)

A minimal runnable node could be:

- HTTP server endpoint: `POST /inbound`
  - Accepts one JSON envelope
  - Loads session state
  - Calls `protocolProcessor.processInbound(...)`
  - Saves next_state
  - Runs `triggerFriendshipWriteIfNeeded(...)`
  - Returns a JSON ack `{ ok: true }` (or fail-closed error)

- HTTP client function: `sendOutbound(url, envelope)`
  - Sends signed/validated envelope
  - No retries/backoff

This is sufficient to demonstrate a single-node runtime wiring without implementing discovery, mesh, or distributed coordination.
