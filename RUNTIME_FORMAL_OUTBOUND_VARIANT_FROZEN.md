# Runtime Formal Outbound Variant — Frozen Record

Frozen on: 2026-03-13 (Asia/Shanghai)

The formal outbound runtime integration variant is **FROZEN**.
Behavior must remain stable unless fixing a **critical bug**.

## 1) Implemented components

- `startRuntimeNodeFormal(...)`
  - Module: `src/runtime/node/runtimeNodeFormal.mjs`
  - Additive runtime entrypoint that wires Phase 7 formal outbound into the runtime

- `createMessageRouterFormal(...)`
  - Module: `src/runtime/router/messageRouterFormal.mjs`
  - Router variant that can select between formal outbound and test-stub outbound

- Formal outbound integration via Phase 7 builder
  - Calls `formalOutboundBuilder.buildFormalOutboundEnvelope(...)`
  - Sends the resulting formal Phase 2 envelope via transport

- Explicit formal/stub separation
  - Formal outbound uses an explicitly configured `formalOutboundUrl`
  - TEST_STUB_OUTBOUND remains test-only and separate

- Formal precedence over stub
  - If both are enabled, formal path is taken and stub must not send

## 2) Safety boundaries

- This is an additive runtime variant only
  - It does not replace the frozen Phase 6 runtime

- `formalOutboundUrl` must be explicitly configured (trusted peer endpoint)
  - Runtime must not infer outbound target from inbound messages
  - No dynamic discovery

- Formal outbound is disabled unless explicitly enabled
  - `enableFormalOutbound === true` required

## 3) Explicitly NOT implemented

- discovery
- dynamic peer endpoint selection
- retry/backoff
- queueing/batching
- distributed runtime
- additional outbound protocol behavior

## 4) Hard separation rules

- Must not modify frozen Phase 6 runtime
- Must not modify protocol core behavior
- Must not treat `TEST_STUB_OUTBOUND` as formal protocol output
