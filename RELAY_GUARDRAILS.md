# Relay Guardrails (A2A-FUN)

This document defines strict architectural guardrails for the relay layer.

Scope: documentation only.

---

## 1) Purpose

Relay exists because:
- **Direct peer transport is primary** and should be used whenever reachable.
- **Relay exists only as fallback** for NAT/firewall/non-reachable peers.
- Relay is a **transport-only** component.

Relay must not become a centralized message hub or protocol brain.

---

## 2) Core Principle

**Relay MUST remain a dumb, stateless, opaque forwarder.**

Definitions:
- **dumb** = MUST NOT interpret protocol, MUST NOT embed trust semantics, MUST NOT contain routing intelligence.
- **stateless** = MUST NOT store long-term protocol/session/friendship state; only temporary live-connection mapping is allowed.
- **opaque** = MUST forward payloads without inspecting, mutating, or “improving” them.

---

## 3) What Relay MAY Do

Relay MAY:
- maintain a temporary in-memory mapping: `node_id -> live connection`
- accept outbound client WebSocket connections
- forward opaque payloads to connected targets
- drop safely if a target is not connected
- remove live mapping on disconnect

---

## 4) What Relay MUST NOT Do

Relay MUST NOT:
- store friendship state
- store session state
- store protocol progress
- decide trust
- interpret envelopes
- rewrite envelopes
- choose smart routes
- recommend peers
- become a source of truth for node identity
- persist offline messages
- implement queue/retry/backoff
- act as a mailbox
- become a discovery mesh

---

## 5) Relationship to Other Layers

Separation of concerns:
- **Bootstrap** handles candidate peer discovery.
- **Transport** handles delivery (direct first, relay second).
- **Protocol layers** handle trust/probe/state.
- **Friendship layer** handles persistence of established relationships.
- **Mailbox** (if ever added) MUST remain separate from relay.

Relay is below protocol semantics and must not leak upward responsibilities.

---

## 6) Failure Model

- Relay failure MUST remain below protocol semantics.
- Relay MAY fail closed.
- Relay failure MUST NOT corrupt protocol state.
- Relay failure MUST NOT corrupt friendship state.

Implication: a relay outage is an availability event only.

---

## 7) Scaling Guardrail

Core anti-pattern:

**Relay MUST NOT evolve into a centralized stateful message broker.**

Why this is dangerous:
- larger failure radius
- architectural drift
- hidden centralization
- protocol/state pollution

If the relay starts holding state, it becomes a control-plane by accident.

---

## 8) Explicit Non-Goals

Relay is explicitly NOT responsible for:
- mailbox behavior
- offline queue
- trust graph storage
- routing policy engine
- distributed runtime coordination
- control-plane authority

---

## 9) Summary

Relay in A2A-FUN is **transport fallback only**.
It MUST remain **dumb, stateless, and opaque**.
