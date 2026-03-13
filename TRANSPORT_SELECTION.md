# A2A-FUN — Transport Selection Rules

## 1) Purpose

Transport selection is required because:
- some peers are directly reachable (public IP / open inbound ports)
- some peers are behind NAT/firewalls (no inbound reachability)
- the network should prefer the simplest, lowest-latency transport first

This document defines transport selection without changing any frozen protocol behavior.

---

## 2) Transport Priority

Transport priority is explicitly:

1. **Direct peer transport** (primary)
2. **Relay transport** (fallback)
3. **Mailbox** (optional / future; not part of baseline always-on path)

Mailbox is not part of the baseline always-on communication path for always-on agent nodes.

---

## 3) Direct Peer Transport

Direct peer transport is the preferred path:
- lowest latency
- simplest failure model
- no third-party forwarding dependency

Rule:
- If the target peer is reachable directly, use direct peer transport.

This is the default transport expectation for always-on agents (OpenClaw-style nodes).

---

## 4) Relay Transport

Relay is a fallback transport used when direct reachability is not available.

Relay exists for:
- NAT / CGNAT
- restrictive firewalls
- networks where inbound ports cannot be opened reliably

Relay properties:
- forwards **opaque protocol envelopes**
- must not interpret protocol semantics
- must not implement friendship logic
- must not persist protocol state
- must not implement queue/retry/backoff as part of the baseline path

Relay is transport-only. Trust and protocol semantics remain in the frozen protocol layers.

---

## 5) Mailbox Position

Mailbox is not part of the baseline always-on communication path.

Mailbox may exist in the future for:
- asynchronous delivery
- offline peers

Mailbox is not the default path for always-on agent nodes.

---

## 6) Transport Selection Rules

Rules:
- If direct peer connectivity succeeds, do not use relay.
- If direct peer connectivity fails, relay may be attempted.
- Transport fallback must not change protocol envelope semantics.
- Transport fallback must not corrupt protocol state.

Transport selection is an orchestration decision below protocol semantics.

---

## 7) Failure Handling

Failure handling principles:
- Direct transport failure must not corrupt protocol state.
- Relay transport failure must not corrupt protocol state.
- Transport failures must remain below protocol semantics.
- Fail-closed behavior must be preserved.

---

## 8) Relationship to Existing Components

Mapping to the current system:
- Bootstrap provides candidate peers.
- Auto-join provides initial known peers.
- Relay server/client provide fallback transport.
- Protocol layers remain above transport.

Transport selection is strictly an additive integration layer; it must not modify frozen protocol behavior.

---

## 9) Explicit Non-Goals

This transport model does NOT implement:
- discovery mesh
- swarm routing
- automatic trust propagation
- queue/retry/backoff orchestration
- mailbox-first communication
- distributed runtime routing

---

## 10) Summary

A2A-FUN transport selection is:

- **Direct first**
- **Relay second**
- **Mailbox optional and not part of the baseline always-on path**
