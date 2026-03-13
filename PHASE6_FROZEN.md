# Phase 6 Frozen Record (a2a.fun) — Minimal HTTP Runtime Node

Frozen on: 2026-03-13 (Asia/Shanghai)

Phase 6 minimal runtime is **FROZEN**.
Behavior must remain stable unless fixing a **critical bug**.

## 1) Implemented components

- runtimeNode
  - Module: `src/runtime/node/runtimeNode.mjs`
  - Starts an HTTP server and wires runtime components

- httpTransport
  - Module: `src/runtime/transport/httpTransport.mjs`
  - Receive: `POST /message` with JSON `{ envelope }`
  - Send: HTTP POST JSON `{ envelope }` (no retries)

- messageRouter
  - Module: `src/runtime/router/messageRouter.mjs`
  - Handles inbound envelopes and orchestrates wiring steps

- Minimal HTTP ingress
  - Fail-closed on bad JSON

- protocolProcessor wiring
  - Inbound envelopes are passed to `protocolProcessor.processInbound({ envelope, state })`

- session persistence wiring
  - Writes FULL `session_apply_result.next_state` snapshot to storage (`writeSession`)
  - No patch-based persistence

- optional probe wiring
  - If `probeEngine` is provided, `probeEngine.next({ state, transcript: [] })` may be called

- optional friendship trigger wiring
  - Friendship trigger is optional and requires explicit enable flag

- test_stub outbound mode
  - Only supports `TEST_STUB_OUTBOUND` payloads
  - Auto-send is disabled by default

## 2) Runtime safety boundaries

- outbound is disabled by default
- only `TEST_STUB_OUTBOUND` is allowed in this phase
- `reply_to_url` is test-only and localhost-only
- friendship trigger is optional and disabled by default
- runtime writes full `next_state` snapshot only

## 3) Explicitly NOT implemented

- formal Phase 2 outbound envelope
- signing/encryption on runtime egress
- discovery
- mesh/swarm/distributed runtime
- retry/reconnect/backoff
- transcript persistence
- advanced runtime driver logic

## 4) Fail-closed rules

- bad JSON -> reject
- processor failure -> no session write / no outbound / no friendship trigger
- storage failure -> no downstream actions
- runtime must not corrupt protocol state

## 5) Hard separation rules

- runtime wiring MUST NOT modify frozen phases
- runtime MUST NOT introduce protocol behavior
- runtime MUST NOT treat test_stub outbound as formal protocol output
