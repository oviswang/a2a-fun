# Phase 7 Plan (a2a.fun) — Formal Protocol Egress — Planning Only

Date: 2026-03-13 (Asia/Shanghai)

Phases 1–6 and the Friendship Trigger layer are frozen.
This document is Phase 7 planning only. **Do NOT implement yet.**

---

## 1) Purpose

Phase 7 defines how outbound protocol messages are **formally produced** as valid Phase 2 envelopes.

This differs from Phase 6 `TEST_STUB_OUTBOUND`:
- Phase 6 outbound is a **test-only wiring payload** and must not be treated as protocol output.
- Phase 7 outbound is a **real protocol envelope** that satisfies:
  - body schema requirements
  - encryption requirements
  - deterministic envelope assembly
  - signature requirements

---

## 2) Scope

Phase 7 egress should cover:
- Formal Phase 2 envelope assembly
- Body placement into ciphertext payload
- Signing on outbound (Ed25519 over `UTF8(JCS(envelope_without_sig))`)
- Encryption on outbound
- Machine-safe egress preparation (no raw handle leakage)

Out of scope:
- Transport routing/discovery
- Any state machine changes

---

## 3) Separation of concerns

Hard boundaries:
- Runtime must not invent protocol behavior
  - runtime only wires processing and calls the egress builder
- protocolProcessor must not directly perform transport send
  - protocolProcessor returns processing results only
- ProbeEngine decides what message to emit, not how to send it
  - ProbeEngine outputs message intent (type + body)
- Egress builder prepares formal protocol output
  - validates body, encrypts, assembles, signs
- Transport only sends already-constructed outbound protocol envelopes

---

## 4) Required outbound pipeline

Formal outbound pipeline (Phase 7):

outbound message intent
→ body schema validation (fail closed)
→ encrypt body (fail closed)
→ assemble Phase 2 envelope (deterministic fields)
→ sign `envelope_without_sig` (fail closed)
→ send via transport (transport failure must not mutate protocol state)

Notes:
- Encryption must produce ciphertext-only transcript binding inputs (align with Phase 2 rules).
- Outbound lint remains defense-in-depth; schema validation is authoritative.

---

## 5) Minimal implementation candidate (smallest safe subset)

Start with the smallest safe subset:

- Implement a single egress builder module (outside frozen Phase 2) that can produce a formal envelope for:
  1) `probe.question`
  2) `probe.done`

Why these:
- They are deterministic and already constrained by Phase 2 body schema (safe short text / done flag).

Keep minimal assumptions:
- Peer public key is already available and trusted (or injected as a prerequisite), otherwise fail closed.

---

## 6) Failure rules (fail closed)

- Encryption failure must fail closed (throw)
- Signing failure must fail closed (throw)
- Invalid outbound body must fail closed (throw)
- Transport failure must not mutate protocol state
  - egress builder returns a ready-to-send envelope; sending is separate

---

## 7) Explicitly NOT implemented

- discovery
- distributed runtime
- retry/backoff
- advanced queueing
- batch send
- multiplexed session orchestration

---

## 8) Output contract

The formal outbound builder should return a machine-safe structure like:

- `FORMAL_ENVELOPE_READY`
  - includes the complete Phase 2 envelope (with `sig`)
  - includes machine-safe metadata only (no raw handles)

On failure:
- throw (fail closed)

Example shape:
```js
{
  status: 'FORMAL_ENVELOPE_READY',
  envelope
}
```
