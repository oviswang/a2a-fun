# Transport Baseline — Frozen Record

Frozen on: 2026-03-14 (Asia/Shanghai)

The A2A-FUN transport baseline is **FROZEN**.
Do not change behavior except for critical bug/security fixes.

## 1) Implemented components

- Direct reachability probe
  - `src/runtime/transport/checkDirectReachability.mjs`

- Transport selection rules
  - `src/runtime/transport/selectTransport.mjs`

- Transport decision bridge (probe + select)
  - `src/runtime/transport/decideTransport.mjs`

- Transport executor (decision + minimal send)
  - `src/runtime/transport/executeTransport.mjs`

- Direct inbound bridge
  - `src/runtime/inbound/directInbound.mjs`

- Relay inbound bridge
  - `src/runtime/inbound/relayInbound.mjs`

- Relay server (WebSocket)
  - `src/relay/relayServer.mjs`

- Relay client (WebSocket outbound)
  - `src/runtime/transport/relayClient.mjs`

## 2) Hard rules

- Priority:
  - direct first
  - relay second
  - mailbox is NOT in the baseline path

- Transport layer rules:
  - no protocol interpretation in transport
  - no envelope mutation
  - no friendship logic
  - fail-closed behavior preserved

## 3) Explicitly NOT implemented

- mailbox transport
- queue/retry/backoff
- dynamic discovery mesh
- trust propagation
- deployment/runtime-wide orchestration
- full automatic direct/relay switching across the whole runtime

## 4) Hard separation boundaries

- Transport remains below protocol semantics.
- Transport must not change any frozen protocol behavior.
- Inbound bridge only hands off payload to the caller-provided `onInbound(payload)`.
