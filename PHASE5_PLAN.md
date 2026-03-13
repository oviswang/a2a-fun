# Phase 5 Plan (a2a.fun) — Handshake / Peer Key Binding / Minimal Runtime Core — Planning Only

Date: 2026-03-13

Phases 1, 2, 3, 3.5, and 4 are frozen.
This document is Phase 5 planning only. **Do NOT implement yet.**

---

## 1) Purpose

Phase 5 adds the minimum missing pieces needed to move from “validated protocol core” to a **minimally real secured runtime relationship**:

- Establish a way to **bind a peer’s long-term public key** to `peer_actor_id` (peer key trust)
- Define a **handshake** that proves:
  - the peer controls the private key corresponding to the public key presented
  - both sides are talking about the same session context (anti-mixup)
- Define minimal runtime communication assumptions (without solving discovery/routing)

Phase 5 does **not** implement transport or a distributed runtime; it defines the trust and binding rules that later phases will rely on.

---

## 2) Scope

In scope:
- Peer key binding
  - rules for when `peer_key_fpr` becomes trusted and stored
- Handshake rules
  - minimal proof-of-possession and context binding
- Minimal runtime communication assumptions
  - what must exist to exchange handshake messages (not how to route/discover)

Out of scope (explicit):
- Transport implementation (WebRTC/TCP runtime)
- Peer discovery / routing / NAT traversal / retries
- Probe engine strategy changes
- Friendship persistence changes
- Any relaxation of fail-closed validation

---

## 3) Separation of concerns

Hard boundaries (must remain true):
- Handshake is not SessionManager
  - handshake must not change the Phase 2 transition rules; it can only influence whether higher layers accept/continue
- Handshake is not friendship persistence
  - key binding and handshake validation must not write friendship records
- Transport is not probe logic
  - probe engine remains deterministic logic, not a network subsystem
- Runtime communication is not discovery
  - assume a communication channel exists; do not design how peers find each other

---

## 4) Peer key binding rules

### When `peer_key_fpr` becomes trusted
- A peer key becomes “trusted/bound” only after a successful handshake that:
  1) verifies signature proof-of-possession under the peer public key, and
  2) binds that proof to the relevant session/context (anti-mixup), and
  3) matches `peer_actor_id` expectations (no raw handle exchange)

### If peer key is missing
Fail-closed options:
- If a message requires verification but the peer key is unknown: reject processing (do not continue) OR require handshake first.

Recommended minimal rule:
- Reject runtime messages that require peer identity assurance until handshake completes.

### If peer key mismatches
- If a stored/bound `peer_key_fpr` exists for `peer_actor_id` and a different key is presented:
  - FAIL CLOSED (treat as possible impersonation / key rotation without consent)
  - Do not overwrite binding automatically

Key rotation policy (future):
- Must require an explicit user-local action (local event) to accept rotation.

### Failure isolation
- Key binding failures must not corrupt session state.
- Key binding is a higher-layer gate: it can block progression/acceptance but must not mutate Phase 2 state machine behavior.

---

## 5) Handshake model

### What the minimal handshake proves
At minimum, a successful handshake proves:
- The peer controls the private key for the presented public key (proof-of-possession)
- The handshake messages are bound to a specific session context (anti-mixup / anti-replay within reasonable limits)

### What it does not prove
- It does not prove real-world identity behind `peer_actor_id`
- It does not prove network-level origin (IP/device), only cryptographic possession
- It does not solve discovery, routing, or transport security details

---

## 6) Minimal runtime assumptions

Assume (minimally) the system can exchange a small number of messages between peers:
- A request/response (or challenge/response) pair for handshake
- Reliable ordering is not required, but finite rounds are assumed

Still out of scope:
- Automatic retries/backoff
- Multi-hop relay or routing
- NAT traversal strategies
- Persistent connections

---

## 7) Failure rules (fail-closed)

All failures must remain fail-closed and must not mutate protocol state.

- Missing key
  - Reject messages that require verification, or require handshake first

- Key mismatch
  - Reject; do not overwrite stored bindings

- Handshake failure
  - Reject; do not bind peer key

- Transport failure
  - Treat as non-delivery; do not “assume handshake succeeded”

---

## 8) Minimal implementation candidate (smallest safe subset)

Smallest safe subset worth implementing first (Phase 5 minimal):

1) A new handshake module (outside Phase 2) that:
- Can generate a handshake request payload
- Can validate a handshake response payload
- Produces a deterministic success/failure result

2) A peer key binding store update rule:
- On first successful handshake: persist `peer_key_fpr` for `peer_actor_id`
- On mismatch: fail closed

3) Integration point (outside protocol core):
- The application layer gates “acceptance/continuation” on handshake completion
- protocolProcessor and SessionManager remain unchanged

This keeps Phase 5 additive, testable, and compatible with all frozen layers.
