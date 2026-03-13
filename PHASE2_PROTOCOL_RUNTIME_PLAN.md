# Phase 2 — Protocol Runtime Integration Plan (Transport → Formal Protocol)

Status: planning document (documentation only).

This plan describes how to connect the **transport payload boundary** to the **formal protocol runtime path** without modifying frozen protocol semantics.

---

## 1) Goal

Connect transport-delivered payloads (direct/relay) into the **formal protocol runtime** so that a node can:
- receive an opaque transport payload
- validate it as a **formal Phase 2 envelope**
- process it via the existing protocol processor/state machine
- return a machine-safe transport-level response

In short: **connect transport payload → formal protocol runtime**.

---

## 2) Required path

The required end-to-end path is:

1) **Inbound transport bridges** (payload boundary)
- `directInbound` (HTTP body → payload)
- `relayInbound` (WS forwarded message → payload)

2) **Formal envelope validation** (fail closed)
- Treat payload as candidate `{ envelope }` or a Phase 2 envelope object.
- Validate strict schema/allowlists (Phase 2 envelope schema).
- Reject unknown fields/types; machine-safe errors only.

3) **Runtime wiring (formal path)**
- `messageRouterFormal` is the integration point for formal runtime handling.
- It must route validated inbound envelopes to:
  - `protocolProcessor.processInbound({ envelope, state })`

4) **Protocol processor**
- Existing Phase 2 pipeline ordering and semantics remain authoritative:
  - validate → verify → decrypt → bodyValidate → session-apply → audit
- No transport-layer shortcuts.

5) **Transport response path**
- Transport returns a machine-safe response object:
  - success acknowledgment (minimal)
  - or fail-closed error (machine-safe)
- Response must NOT leak secrets, raw handles, or decrypted contents.

---

## 3) Minimal implementation order

Implement in the smallest safe sequence:

1) Inbound entry
- Add a single runtime entrypoint that accepts payloads from:
  - `directInbound` and `relayInbound`
- Ensure both land on a shared function: `onInbound(payload)`.

2) Formal wiring
- Create/enable a formal runtime handler that expects a Phase 2 envelope payload.
- Wire into `messageRouterFormal` only (do not modify frozen core semantics).

3) Validation
- Strictly validate payload shape as a Phase 2 envelope (fail closed).
- Confirm machine-safe error surface.

4) Session handoff
- Load session snapshot from storage (existing runtime pattern).
- Call `protocolProcessor.processInbound({ envelope, state })`.

5) Response path
- Return transport response:
  - `ok: true` + minimal identifiers
  - or `ok: false` + machine-safe code

6) Local E2E
- Local single-machine E2E:
  - direct inbound → formal handler → processor → response
- Local two-node E2E:
  - Node A sends a real Phase 2 envelope to Node B (direct)

7) Two-machine E2E
- Real two-machine validation:
  - direct path when reachable
  - relay path when direct is unavailable
- Confirm payload unchanged at transport boundary and fail-closed preserved.

8) Freeze
- Write a freeze document for the protocol runtime integration wiring:
  - list exact entrypoints
  - list exact invariants
  - explicitly state what is NOT implemented

---

## 4) Hard constraints

- MUST NOT modify frozen protocol semantics (Phase 2 pipeline, SessionManager transitions, audit semantics).
- MUST keep fail-closed behavior.
- Transport remains below protocol semantics:
  - transport does not interpret envelopes
  - transport does not mutate envelopes
  - transport does not implement friendship logic

---

## 5) Explicit non-goals

This plan explicitly does NOT include:
- mailbox
- capability layer
- task routing
- trust propagation
- market/economy logic
