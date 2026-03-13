# A2A-FUN — Trust Model

This document defines the **trust establishment model** of the A2A network as implemented by this repository.

Scope: documentation only.
- No code changes to frozen protocol layers.
- This trust model **describes** how trust is established *using* the existing layers; it does not change their behavior.

---

## 1) Design Principles

A2A is not only a connectivity network. It is a **trust establishment network**.

Key idea:
- Connectivity answers: “Can I reach a peer?”
- Trust answers: “Should I treat this peer as a trusted relationship for future interaction?”

A2A-FUN is designed around:
- explicit, auditable trust steps
- fail-closed validation
- separation of concerns (state transitions vs side-effects)
- local-only trust storage (no global trust propagation)

---

## 2) Trust Establishment Lifecycle

Trust is established through a strict lifecycle:

1) **bootstrap** (candidate discovery)
2) **handshake** (identity/key binding)
3) **probe** (behavioral interaction)
4) **mutual confirmation** (both sides consent)
5) **friendship persistence** (local trust record)

Only after completing the lifecycle does a node persist a durable “friend” relationship.

---

## 3) Bootstrap

Bootstrap servers provide **candidate peers**, not trust.

Example endpoints (as implemented by the minimal bootstrap server):
- `POST /join` — register your node URL as a candidate
- `GET /peers` — fetch a machine-safe list of candidate peer URLs

Bootstrap properties:
- bootstrap does not authenticate peers
- bootstrap does not prove identity
- bootstrap does not establish trust
- bootstrap is an explicit trusted entrypoint (configured endpoints; not dynamically learned)

In A2A-FUN, bootstrap is treated as **input that must be validated** and used conservatively.

---

## 4) Handshake

Handshake is the identity-binding step.

A2A-FUN uses a key fingerprint to bind a peer’s public key:
- `peer_key_fingerprint` / `peer_key_fpr`

What handshake establishes:
- “This peer controls the private key corresponding to this public key (proof-of-possession)”
- “This peer identity is stable across sessions via a bound fingerprint”

What handshake does NOT establish:
- it does not establish behavioral trust
- it does not establish relationship consent
- it does not prevent a peer from being malicious

In this repo, Phase 5 implements the **minimal peer key binding subset**:
- compute fingerprint
- compare vs expected/bound
- fail closed on missing/mismatch/conflict

---

## 5) Probe

Probe is the behavior verification / interaction phase.

The goal is to perform a small, deterministic interaction before escalating trust.

Example probe messages:
- `probe.question`
- `probe.answer`
- `probe.done`

Probe success produces:
- `PROBE_COMPLETE` (a state milestone)

Notes on current implementation:
- The deterministic probe engine (Phase 4) is intentionally minimal:
  - fixed questions
  - fixed completion rule
  - strict transcript grammar

---

## 6) Mutual Confirmation

Trust persistence requires mutual consent.

A2A-FUN requires both sides to confirm (conceptually: both humans/agents explicitly enter/consent) before trust is persisted.

State transition example:
- `MUTUAL_ENTRY_CONFIRMED`

This state is the **trigger condition** for friendship persistence.

---

## 7) Friendship Persistence

Friendship persistence stores trust **locally**.

Persistence target:
- `friends.json`

Example record (conceptual minimal shape):
```json
{
  "peer_actor_id": "h:sha256:...",
  "peer_key_fpr": "sha256:...",
  "relationship": "friend"
}
```

Notes on current implementation:
- Phase 3 writes an idempotent friendship record keyed by `peer_actor_id`.
- Persistence is a side-effect layer; it must not be embedded into SessionManager or protocolProcessor.

---

## 8) Trust Graph

The network forms a **trust graph**, not a full mesh.

Example graph:

```
Node A ─── Node B
  │
  └─── Node C
```

Practical implications:
- Trust is local-first: each node persists its own friend set.
- “Everyone connects to everyone” is explicitly avoided.

Communication priority (conceptual):
1) direct friends
2) friends-of-friends
3) bootstrap-discovered peers

Important: Current frozen phases **do not implement friends-of-friends trust propagation or routing**.
- The “friends-of-friends” priority is a conceptual future extension point only.
- Today’s implementation supports direct friends + bootstrap candidates, with strict safety boundaries.

---

## 9) Security Properties

A2A-FUN is designed to reduce the risk of:

- Sybil attacks
  - bootstrap provides candidates, but trust requires handshake + probe + mutual confirmation
  - peer key binding prevents silent key swapping once a peer is bound

- Spam nodes
  - conservative peer selection (small N)
  - deterministic probe limits (no uncontrolled chat growth)
  - fail-closed validation on all inbound content

- Uncontrolled mesh expansion
  - no auto-connect to all discovered peers
  - no discovery mesh/swarm
  - no automatic trust propagation

---

## 10) Relationship with Frozen Protocol Layers

This trust model maps onto the existing frozen layers as follows:

- Identity (actor_id derivation, no-raw-handle safety) → Phase 1
- Protocol validation + state machine → Phase 2
- Handshake / peer key binding subset → Phase 5
- Probe behavior logic (deterministic) → Phase 4
- Mutual confirmation milestone (`MUTUAL_ENTRY_CONFIRMED`) → Phase 2 state machine result
- Friendship persistence side-effect → Phase 3
- Friendship trigger glue (state → persistence) → Friendship Trigger Layer (Phase 3.5)

Hard statement:
- This trust model **does not modify** any frozen protocol behavior.
- It only describes how the existing layers are intended to be used together.

---

## 11) Explicit Non-Goals

This system intentionally does NOT implement:
- mesh networking
- automatic trust propagation
- distributed routing
- automatic connection to every discovered node

---

## 12) Summary

A2A-FUN is an Agent trust network built through:

**identity → interaction → confirmation → persistence**

Bootstrap provides candidates; handshake binds identity; probe verifies behavior; mutual confirmation ensures consent; friendship persistence stores local trust.
