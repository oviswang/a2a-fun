# Phase 7 Frozen Record (a2a.fun) — Minimal Formal Protocol Egress

Frozen on: 2026-03-13 (Asia/Shanghai)

Phase 7 minimal formal protocol egress is **FROZEN**.
Behavior must remain stable unless fixing a **critical bug**.

## 1) Implemented components

- formalOutboundBuilder
  - Module: `src/phase7/egress/formalOutboundBuilder.mjs`
  - Function: `buildFormalOutboundEnvelope(...)`

- Formal Phase 2 outbound envelope assembly
  - Assembles `envelope_without_sig` with Phase 2 fields:
    - from/to refs, crypto params, ciphertext body
  - Adds `sig` to produce a complete Phase 2 envelope

- Outbound body validation
  - Uses frozen Phase 2 body schema validation (fail closed)

- encrypt/sign dependency contracts
  - encrypt must provide required ciphertext payload + crypto metadata
  - sign must return base64 signature over `envelope_without_sig`

- Fail-closed outbound preparation
  - Any invalid body / unsupported type / encrypt/sign issues throw

- Supported outbound types (minimal)
  - `probe.question`
  - `probe.done`

## 2) Builder contract

- Caller must provide `msg_id` and `ts`
  - Builder does not generate identity/timestamp fields

- encrypt(body) must return (required fields):
  - `ciphertext`, `nonce`, `enc`, `kdf`, `content_type`

- sign(envelope_without_sig) must return:
  - a non-empty **base64** signature string

## 3) Result contract

Success:
- `FORMAL_ENVELOPE_READY`

Fail closed (throw):
- invalid outbound body
- encrypt failure
- missing encrypt fields
- sign failure
- invalid sig (empty or not base64)
- unsupported outbound type

## 4) Explicitly NOT implemented

- transport send
- discovery
- retry/backoff
- queueing/batch
- distributed runtime
- additional outbound message types

## 5) Hard separation rules

- formalOutboundBuilder prepares protocol envelopes only
- It MUST NOT send transport messages directly
- It MUST NOT modify SessionManager
- It MUST NOT modify protocolProcessor
- It MUST NOT introduce runtime behavior
